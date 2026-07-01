import { supabase } from "@/lib/supabaseClient";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/state/AuthContext";
import { useUser } from "@/state/UserContext";
import { useProject } from "@/state/ProjectContext";
import { useCredits } from "@/state/CreditsContext";
import { useChat } from "@/state/ChatContext";
import { useGeneration } from "@/state/GenerationContext";
import TopBar from "@/components/TopBar";
import Auth from "@/pages/Auth";
import EmptyStartScreen from "@/components/chat/EmptyStartScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Image as ImageIcon, Sparkles, Download, Shield, ChevronLeft, ChevronRight, X, PanelRightClose, PanelRightOpen, AlertTriangle, Search, ExternalLink, MoreHorizontal, Settings, User as UserIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ChatMessage, GeneratedImage } from "@/types";
import logoIcon from "@assets/LOGO-removebg-preview_1771145708755.png";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const SESSION_ID_KEY = 'easypeasy_session_id';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.easypeasylogo.com/webhook/designer-chat';

function useTypewriter(text: string, speed = 28) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(id);
        setDone(true);
      }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return { displayed, done };
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;

const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_PRESET = import.meta.env.VITE_CLOUDINARY_PRESET;

async function uploadFileToCloudinary(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_PRESET);
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: formData }
  );
  if (!res.ok) throw new Error(`Cloudinary upload failed: ${res.status}`);
  const data = await res.json();
  return data.secure_url as string;
}

const IMAGE_URL_REGEX = /https?:\/\/\S+\.(jpg|jpeg|png)(?:\?\S*)?/gi;

function getSessionId(): string {
  let id = localStorage.getItem(SESSION_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_ID_KEY, id);
  }
  return id;
}

function getInitials(user: any): string {
  if (user?.name) {
    const parts = user.name.trim().split(" ");
    return parts.slice(0, 2).map((p: string) => p[0]).join("").toUpperCase();
  }

  if (user?.email) {
    const prefix = user.email.split("@")[0];
    const parts = prefix.split(/[._-]/);

    if (parts.length > 1) {
      return parts.slice(0, 2).map((p: string) => p[0]).join("").toUpperCase();
    }

    return prefix[0].toUpperCase();
  }

  return "U";
}

export default function AppPage() {
  const [, setLocation] = useLocation();
  const { state: authState } = useAuth();
  const { state: userState } = useUser();
  const { state: projectState, setProject } = useProject();
  const { state: creditsState, setCredits } = useCredits();
  const { state: chatState, addMessage, setMessages, updateMessage } = useChat();
  const { state: generationState, setStatus, addImages, setImages } = useGeneration();
  const inputRef = useRef<HTMLInputElement>(null);
  const genTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeGenerationProjectIdRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttemptsRef = useRef<number>(0);

  useEffect(() => {
    // Initial focus on load
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, []);

  // --- SUPABASE REALTIME: Listen for new messages ---
  useEffect(() => {
    const projectId = projectState.activeProject?.project_id;
    if (!projectId) return;

    const channel = supabase
      .channel(`chat-messages-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `project_id=eq.${projectId}`
        },
        (payload) => {
          const newMsg = payload.new;
          // Only add if it's from designer and not already in chat
          if (newMsg.sender === 'designer') {
            console.log('📩 New message from designer via Realtime!', newMsg);
            
            // Check if message already exists in state
            const exists = chatState.messages.some(
              m => m.chat_message_id === newMsg.chat_message_id
            );
            
            if (!exists) {
              addMessage({
                chat_message_id: newMsg.chat_message_id,
                project_id: newMsg.project_id,
                sender: newMsg.sender,
                content: newMsg.content,
                created_at: newMsg.created_at
              });
              
              // Stop loading states
              setStatus('idle');
              stopLoadingTimer();
              setSendingProjects(prev => { 
                const n = { ...prev }; 
                delete n[projectId]; 
                return n; 
              });
              
              // Clear polling if active
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
                pollAttemptsRef.current = 0;
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [projectState.activeProject?.project_id]);

  const sessionId = useRef(getSessionId()).current;
  const [introPlayed, setIntroPlayed] = useState(false);
  const [introRunning, setIntroRunning] = useState(false);
  const [showIntroTyping, setShowIntroTyping] = useState(false);
  const [upgradePromptOpen, setUpgradePromptOpen] = useState(false);
  const [upgradeContext, setUpgradeContext] = useState<"limit" | "new_project" | null>(null);
  const [isLimitReached, setIsLimitReached] = useState(false);
  const [showNoCreditsModal, setShowNoCreditsModal] = useState(false);
  const creditButtonRef = useRef<HTMLButtonElement | null>(null);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const loadingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const STATUS_MESSAGES = [
    { at: 10,  text: "Analyzing brand summary details..." },
    { at: 25,  text: "Structuring design briefs..." },
    { at: 40,  text: "Concepts are being engineered..." },
    { at: 55,  text: "Analyzing your brand preferences..." },
    { at: 70,  text: "Sketching out your layout motifs..." },
    { at: 85,  text: "Applying tailored color schemes..." },
    { at: 100, text: "Refining the high-res details..." },
    { at: 115, text: "Polishing up Concept 1 and Concept 2..." },
    { at: 130, text: "Securing your assets to the gallery..." },
    { at: 145, text: "Almost there, hang tight..." },
    { at: 160, text: "Putting on the final designer touches..." },
  ];

  function getLoadingStatusText(seconds: number): string | null {
    if (seconds < 10) return null;
    const LOOP = 175;
    const looped = ((seconds - 10) % LOOP) + 10;
    let result = STATUS_MESSAGES[0].text;
    for (const msg of STATUS_MESSAGES) {
      if (looped >= msg.at) result = msg.text;
      else break;
    }
    return result;
  }

  function startLoadingTimer() {
    if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);
    setLoadingSeconds(0);
    loadingIntervalRef.current = setInterval(() => {
      setLoadingSeconds(s => s + 1);
    }, 1000);
  }

  function stopLoadingTimer() {
    if (loadingIntervalRef.current) {
      clearInterval(loadingIntervalRef.current);
      loadingIntervalRef.current = null;
    }
    setLoadingSeconds(0);
  }

  const getMessageLimitKey = () => {
    const sessionProjectId = localStorage.getItem("easypeasy_session_project_id");
    return `easypeasy_free_messages_${sessionProjectId}`;
  };

  const requireAuth = (reason: "limit" | "new_project") => {
    if (reason === "limit") {
      setIsLimitReached(true);
    } else {
      openAuthModal();
    }
  };

  const addSystemMessage = (text: string) => {
    const projectId = projectState.activeProject?.project_id || localStorage.getItem("easypeasy_session_project_id");
    if (!projectId) return;
    addMessage({
      chat_message_id: crypto.randomUUID(),
      project_id: projectId,
      sender: "system",
      content: text,
      created_at: new Date().toISOString()
    });
  };

  const [input, setInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [sendingProjects, setSendingProjects] = useState<Record<string, boolean>>({});

  const currentActiveId = projectState.activeProject?.project_id || (projectState.activeProject as any)?.id || "";
  const isSending = !!sendingProjects[currentActiveId];
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [attachedImageUrls, setAttachedImageUrls] = useState<string[]>([]);
  const [attachedImageIntents, setAttachedImageIntents] = useState<("inspiration" | "reference")[]>([]);
  const [attachedRawFile, setAttachedRawFile] = useState<File | null>(null);
  const [isCloudinaryUploading, setIsCloudinaryUploading] = useState(false);
  const [activeImageUsage, setActiveImageUsage] = useState<"inspiration" | "reference" | null>(null);
  const [showImageIntentModal, setShowImageIntentModal] = useState(false);
  const pendingIntentRef = useRef<"inspiration" | "reference">("inspiration");
  const [authModalContext, setAuthModalContext] = useState<"default" | "image" | "generation">("default");
  const [projectList, setProjectList] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!authState.loading && !authState.isAuthenticated) {
      const STORAGE_KEY = "easypeasy_session_project_id";
      let sessionId = localStorage.getItem(STORAGE_KEY);
      
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        localStorage.setItem(STORAGE_KEY, sessionId);
      }

      const defaultProj = {
        project_id: sessionId,
        name: "First Brand Design",
        user_id: null as any,
        created_at: new Date().toISOString(),
        isActive: true
      };

      setProject(defaultProj);
      setProjectList([{ id: sessionId, name: defaultProj.name }]);
    }
  }, [authState.isAuthenticated, authState.loading]);

  useEffect(() => {
    if (!authState.loading && !authState.isAuthenticated) {
      const sessionProjectId = localStorage.getItem("easypeasy_session_project_id");
      if (!sessionProjectId) return;

      const introKey = `easypeasy_intro_played_${sessionProjectId}`;
      if (localStorage.getItem(introKey) === "true") {
        setIntroPlayed(true);
      }

      if (chatState.messages.length === 0 && !introPlayed && !introRunning) {
        const runIntro = async () => {
          setIntroRunning(true);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const typeText = async (text: string) => {
            setShowIntroTyping(true);
            await new Promise(resolve => setTimeout(resolve, 900));
            setShowIntroTyping(false);

            const projectId = getProjectId();
            const msgId = crypto.randomUUID();
            
            // Insert empty assistant bubble
            addMessage({
              chat_message_id: msgId,
              project_id: projectId,
              sender: "designer",
              content: "",
              created_at: new Date().toISOString()
            });

            // Animate multiple characters per update (ChatGPT-style)
            const chunkSize = 3;
            for (let i = chunkSize; i <= text.length + (chunkSize - 1); i += chunkSize) {
              await new Promise(resolve => setTimeout(resolve, 30));
              const currentText = text.slice(0, Math.min(i, text.length));
              updateMessage(msgId, currentText);
            }
          };

          await typeText("Hi! I'm your brand identity designer.\nI help align your visual identity so your brand builds trust and attracts the right clients.");
          await new Promise(resolve => setTimeout(resolve, 600));
          await typeText("Tell me a bit about your brand or the idea you're exploring. 🙂");
          
          localStorage.setItem(introKey, "true");
          setIntroPlayed(true);
          setIntroRunning(false);
        };
        runIntro();
      }
    }
  }, [authState.isAuthenticated, authState.loading]);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerImages, setViewerImages] = useState<GeneratedImage[]>([]);
  const [search, setSearch] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  
  const [renameProject, setRenameProject] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteProject, setDeleteProject] = useState<{ id: string; name: string } | null>(null);

  const openRenameModal = (project: { id: string; name: string }) => {
    setRenameProject(project);
    setRenameValue(project.name);
  };

  const openDeleteModal = (project: { id: string; name: string }) => {
    setDeleteProject(project);
  };

  const handleRenameProject = async () => {
    if (!renameProject) return;

    if (!authState.isAuthenticated) {
      setRenameProject(null);
      openAuthModal();
      return;
    }

    try {
      const { error } = await supabase
        .from("projects")
        .update({ name: renameValue.trim() })
        .eq("project_id", renameProject.id);

      if (error) {
        console.error("Rename project failed:", error);
        return;
      }

      setProjectList(prev =>
        prev.map(p =>
          p.id === renameProject.id ? { ...p, name: renameValue.trim() } : p
        )
      );

      if (projectState.activeProject?.project_id === renameProject.id) {
        setProject({
          ...projectState.activeProject,
          name: renameValue.trim()
        });
      }

      setRenameProject(null);
    } catch (err) {
      console.error("Unexpected rename error:", err);
    }
  };

  const confirmDeleteProject = async () => {
    if (!deleteProject) return;

    if (!authState.isAuthenticated) {
      setDeleteProject(null);
      openAuthModal();
      return;
    }

    try {
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("project_id", deleteProject.id);

      if (!error) {
        setProjectList(prev => prev.filter(p => p.id !== deleteProject.id));
        if (projectState.activeProject?.project_id === deleteProject.id) {
          setProject(null);
          setMessages([]);
          // Clear all generation/loading state so the input doesn't stay locked
          setStatus('idle');
          stopLoadingTimer();
          setSendingProjects({});
        }
      }
    } finally {
      setDeleteProject(null);
    }
  };

  const WELCOME_TEXT = "Welcome — your brand design starts here.";
  const { displayed: typedHeading, done: headingDone } = useTypewriter(
    chatState.messages.length === 0 ? WELCOME_TEXT : "",
    30
  );

  const filteredImages = useMemo(() => {
    const term = search.toLowerCase();
    return generationState.generatedImages.filter(img => 
      img.url.toLowerCase().includes(term) || 
      projectState.activeProject?.project_id.toLowerCase().includes(term)
    );
  }, [generationState.generatedImages, search, projectState.activeProject]);

  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return projectList.filter(p =>
      p.name.toLowerCase().includes(term)
    );
  }, [search, projectList]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isGenerating = generationState.status === 'pending' || generationState.status === 'running';
  const isSendLocked = introRunning || isGenerating || isSending;
  const isEmptyAuthenticatedProject = authState.isAuthenticated && chatState.messages.length === 0;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatState.messages, generationState.status]);

  useEffect(() => {
    if (authState.isAuthenticated && authModalOpen) {
      setAuthModalOpen(false);
    }
  }, [authState.isAuthenticated, authModalOpen]);

  useEffect(() => {
    if (!authState.isAuthenticated || !userState.user) return;
    
    const guestSessionId = localStorage.getItem("easypeasy_session_id");
    const guestProjectId = localStorage.getItem("easypeasy_session_project_id");
    if (!guestSessionId && !guestProjectId) return;

    const promoteGuestProject = async () => {
      try {
        // Check if user already has projects
        const { data: existingProjects, error: checkError } = await supabase
          .from("projects")
          .select("project_id")
          .eq("user_id", userState.user.user_id);

        if (checkError) {
          console.error("Failed to check existing projects:", checkError);
          return;
        }

        // If user already has projects, clean up and return
        if (existingProjects && existingProjects.length > 0) {
          localStorage.removeItem("easypeasy_session_id");
          if (guestProjectId) {
            localStorage.removeItem("easypeasy_session_project_id");
            setProject(null);
          }
          return;
        }

        let project = null;
        if (guestProjectId) {
          const { data: guestProject, error: projectFetchError } = await supabase
            .from("projects")
            .select("*")
            .eq("project_id", guestProjectId)
            .maybeSingle();

          if (projectFetchError) {
            console.error("Failed to fetch guest project:", projectFetchError);
            return;
          }

          if (guestProject) {
            const { error: transferError } = await supabase
              .from("projects")
              .update({
                user_id: userState.user.user_id,
                is_system_default: true
              })
              .eq("project_id", guestProjectId);

            if (transferError) {
              console.error("Failed to transfer guest project:", transferError);
              return;
            }

            project = {
              ...guestProject,
              user_id: userState.user.user_id,
              is_system_default: true
            };
          }
        }

        if (!project) {
          const { data: createdProject, error: createError } = await supabase
            .from("projects")
            .insert({
              user_id: userState.user.user_id,
              name: "First Brand Design",
              is_system_default: true
            })
            .select()
            .single();

          if (createError) {
            console.error("Failed to create promoted project:", createError);
            return;
          }

          project = createdProject;
        }

        if (guestSessionId) {
          const { data: guestMessages, error: fetchError } = await supabase
            .from("guest_messages")
            .select("*")
            .eq("guest_session_id", guestSessionId)
            .order("created_at", { ascending: true });

          if (fetchError) {
            console.error("Failed to fetch guest messages:", fetchError);
          } else if (guestMessages && guestMessages.length > 0 && project) {
            const messagesToInsert = guestMessages.map(m => ({
              project_id: project.project_id,
              sender: m.sender,
              content: m.content,
              created_at: m.created_at
            }));

            const { error: insertError } = await supabase
              .from("chat_messages")
              .insert(messagesToInsert);

            if (insertError) {
              console.error("Failed to migrate guest messages:", insertError);
            }
          }
        }

        if (project) {
          setProject({
            project_id: project.project_id,
            user_id: userState.user.user_id,
            name: project.name || "First Brand Design",
            created_at: project.created_at,
            isActive: true
          });
          setProjectList([{ id: project.project_id, name: project.name || "First Brand Design" }]);
        }

        if (guestSessionId) {
          await supabase
            .from("guest_sessions")
            .delete()
            .eq("guest_session_id", guestSessionId);
          localStorage.removeItem("easypeasy_session_id");
        }
        if (guestProjectId) {
          localStorage.removeItem("easypeasy_session_project_id");
        }
      } catch (err) {
        console.error("Guest project promotion failed:", err);
      }
    };

    promoteGuestProject();
  }, [authState.isAuthenticated, userState.user?.user_id]);

  const getProjectId = () => {
    return projectState.activeProject?.project_id || localStorage.getItem("easypeasy_session_project_id");
  };

  const fetchProjectMessages = async (projectId: string): Promise<ChatMessage[]> => {
    try {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Error loading messages:", error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.error("Failed to fetch messages:", err);
      return [];
    }
  };

  // On project load: hydrate gallery sidebar + inject concept bubbles from logo_gallery
  useEffect(() => {
    if (!authState.isAuthenticated) return;
    const projectId = projectState.activeProject?.project_id;
    if (!projectId) return;

    const loadHistory = async (options?: { skipMessages?: boolean; skipScroll?: boolean }) => {
      const [chatMessages, galleryResult, projectRowResult] = await Promise.all([
        options?.skipMessages ? [] : fetchProjectMessages(projectId),
        supabase
          .from("logo_gallery")
          .select("*")
          .eq("user_id", userState.user?.user_id)
          .order("created_at", { ascending: true }),
        supabase
          .from("projects")
          .select("generation_status")
          .eq("project_id", projectId)
          .single(),
      ]);

      const galleryData = galleryResult.data || [];
      if (galleryResult.error) {
        console.error("Error loading logo_gallery:", galleryResult.error);
      }

      // Build ALL account-wide images for the sidebar gallery (ignores project_id)
      const allImages: GeneratedImage[] = [];
      galleryData.forEach((row: any) => {
        if (row.concept_1_url) allImages.push({
          generated_image_id: row.id ? `${row.id}-1` : crypto.randomUUID(),
          project_id: row.project_id,
          url: row.concept_1_url,
          title: row.concept_1_title || "Concept 1",
          created_at: row.created_at || new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        });
        if (row.concept_2_url) allImages.push({
          generated_image_id: row.id ? `${row.id}-2` : crypto.randomUUID(),
          project_id: row.project_id,
          url: row.concept_2_url,
          title: row.concept_2_title || "Concept 2",
          created_at: row.created_at || new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        });
      });
      // Replace (not append) so repeated loads never duplicate the gallery
      setImages(allImages);

      if (!options?.skipMessages) {
        // Build chat bubbles ONLY for the currently active project
        const galleryMsgs: ChatMessage[] = [];
        galleryData
          .filter((row: any) => row.project_id === projectId)
          .forEach((row: any) => {
            if (!row.concept_1_url && !row.concept_2_url) return;
            galleryMsgs.push({
              chat_message_id: row.id ? `gallery-${row.id}` : crypto.randomUUID(),
              project_id: projectId,
              sender: "designer",
              content: "",
              created_at: row.created_at || new Date().toISOString(),
              concept_1_url: row.concept_1_url || undefined,
              concept_1_title: row.concept_1_title || undefined,
              concept_2_url: row.concept_2_url || undefined,
              concept_2_title: row.concept_2_title || undefined,
            });
          });

        // Merge and sort by created_at so concept cards appear inline
        const allMessages = [...chatMessages, ...galleryMsgs].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        setMessages(allMessages);
      }

      // Check if a generation is still in-flight
      const isGenerating = projectRowResult.data?.generation_status === "generating";

      if (isGenerating && !options?.skipMessages) {
        // Restore the premium loading divider layout
        setSendingProjects(prev => ({ ...prev, [projectId]: true }));
        setStatus('running');
        addSystemMessage("Creating concepts...");
      } else if (isGenerating && options?.skipMessages) {
        // Polling tick: just keep the dots alive
        setSendingProjects(prev => ({ ...prev, [projectId]: true }));
        setStatus('running');
      } else if (!isGenerating && !options?.skipMessages) {
        // Done: clear the loading dots on the initial load
        setSendingProjects(prev => { const n = { ...prev }; delete n[projectId]; return n; });
        setStatus('idle');
      }

      if (!options?.skipScroll) {
        // Snap to bottom after messages have rendered
        setTimeout(() => {
          const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]');
          if (viewport) {
            (viewport as HTMLElement).scrollTop = (viewport as HTMLElement).scrollHeight;
          }
        }, 50);
      }

      return isGenerating;
    };

    // REMOVED: Infinite polling - now using Supabase Realtime instead!
    // The polling function was removed to prevent 173+ attempts.

    loadHistory();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        pollAttemptsRef.current = 0;
      }
    };
  }, [authState.isAuthenticated, projectState.activeProject?.project_id]);

  const openAuthModal = () => {
    setAuthModalOpen(true);
  };

  const startNewProject = () => {
    setProjectModalOpen(true);
  };

  const activateProject = (proj: { id: string; name: string }) => {
    setProject({
      project_id: proj.id,
      user_id: userState.user?.user_id || "anonymous",
      name: proj.name,
      created_at: new Date().toISOString(),
      isActive: true
    });

    setSearch("");
    setIsSearchOpen(false);

    requestAnimationFrame(() => {
      const el = document.getElementById(`project-${proj.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  };

  const handleCreateProject = async () => {
    const trimmedName = newProjectName.trim().replace(/\s+/g, ' ');
    if (!trimmedName) {
      setProjectError("Project name cannot be empty.");
      return;
    }
    if (trimmedName.length > 60) {
      setProjectError("Maximum 60 characters.");
      return;
    }

    if (!authState.isAuthenticated) {
      requireAuth("new_project");
      return;
    }

    setIsCreatingProject(true);
    // Simulate slight delay for spinner visibility as requested
    await new Promise(resolve => setTimeout(resolve, 600));

    try {
      const { data, error } = await supabase
        .from("projects")
        .insert([{
          user_id: userState.user?.user_id,
          name: trimmedName,
          is_system_default: false
        }])
        .select()
        .single();

      if (error || !data) {
        setProjectError("Failed to create project.");
        setIsCreatingProject(false);
        return;
      }

    const id = data.project_id;
    setProject({
      project_id: id,
      user_id: userState.user?.user_id || 'anonymous',
      name: trimmedName,
      created_at: data.created_at,
      isActive: true
    });
    setProjectList(prev => [...prev, { id, name: trimmedName }]);
      setMessages([]);
      setProjectModalOpen(false);
      setNewProjectName("");
      setProjectError(null);
    } catch (err) {
      setProjectError("Failed to create project.");
    } finally {
      setIsCreatingProject(false);
    }
  };

  useEffect(() => {
    if (authState.isAuthenticated) {
      const loadProjects = async () => {
        const { data, error } = await supabase
          .from("projects")
          .select("*")
          .order("created_at", { ascending: true });

        if (!error && data) {
          const list = data.map(p => ({
            id: p.project_id,
            name: p.name
          }));
          // Prevent stale queries from overwriting recently created projects
          // Only update if new results have items, or if current list is empty
          if (list.length > 0 || projectList.length === 0) {
            setProjectList(list);
          }

          if (!projectState.activeProject && list.length > 0) {
            const first = data[0];
            setProject({
              project_id: first.project_id,
              user_id: first.user_id,
              name: first.name,
              created_at: first.created_at,
              isActive: true
            });
          } else if (list.length === 0) {
            setProject(null);
          }
        }
      };
      loadProjects();
    }
  }, [authState.isAuthenticated]);

  const extractImageUrls = (text: string): string[] => {
    const matches = text.match(IMAGE_URL_REGEX);
    return matches || [];
  };

  const handleInputChange = (val: string) => {
    setInput(val);
    setUploadError(null);
    const extracted = extractImageUrls(val);
    if (extracted.length > 0) {
      setAttachedImageUrls(prev => {
        const combined = [...prev];
        extracted.forEach(url => {
          if (!combined.includes(url)) combined.push(url);
        });
        return combined;
      });
    }
  };

  const removeAttachedImage = (index: number) => {
    setAttachedImageUrls(prev => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) setActiveImageUsage(null);
      return next;
    });
    setAttachedImageIntents(prev => prev.filter((_, i) => i !== index));
  };

  const openImageIntentModal = () => {
    if (!authState.isAuthenticated) {
      setAuthModalContext("image");
      setAuthModalOpen(true);
      return;
    }
    setShowImageIntentModal(true);
  };

  const selectImageIntent = (intent: "inspiration" | "reference") => {
    pendingIntentRef.current = intent;
    setShowImageIntentModal(false);
    setTimeout(() => fileInputRef.current?.click(), 50);
  };

  // UPDATED: Polling with max 3 attempts
  const startPollingWithLimit = (projectId: string) => {
    // Clear any existing polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    
    pollAttemptsRef.current = 0;
    const MAX_ATTEMPTS = 3;
    
    pollIntervalRef.current = setInterval(async () => {
      pollAttemptsRef.current++;
      
      console.log(`🔍 Polling attempt ${pollAttemptsRef.current}/${MAX_ATTEMPTS} for project ${projectId}`);
      
      // Check if message arrived via Supabase
      const { data, error } = await supabase
        .from("chat_messages")

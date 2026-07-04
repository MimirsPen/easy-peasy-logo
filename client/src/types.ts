export interface User {
  user_id: string;
  email: string;
  isAuthenticated: boolean;
  newsletterOptIn?: boolean;
  created_at?: string;
  hasPurchasedStarter?: boolean;
  hasActiveSubscription?: boolean;
}

export interface Project {
  project_id: string;
  user_id: string;
  name?: string;
  isActive?: boolean;
  created_at?: string;
}

export interface ChatMessage {
  chat_message_id: string;
  project_id: string;
  sender: "user" | "designer" | "system";
  content: string;
  created_at: string;
  // Optional concept images attached to a generation result message
  concept_1_url?: string;
  concept_1_title?: string;
  concept_2_url?: string;
  concept_2_title?: string;
}

export interface ImageReference {
  image_reference_id: string;
  project_id: string;
  mime_type: string;
}

export interface GeneratedImage {
  generated_image_id: string;
  project_id: string;
  url: string;
  title?: string;
  created_at: string;
  expires_at: string;
}

export interface GenerationJob {
  generation_job_id: string;
  project_id: string;
  status: "pending" | "running" | "completed" | "failed_rate_limited" | "failed_error";
  created_at: string;
}

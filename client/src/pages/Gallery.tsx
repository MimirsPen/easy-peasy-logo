import { useAuth } from "@/state/AuthContext";
import { useGeneration } from "@/state/GenerationContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useLocation } from "wouter";
import { ChevronLeft, Search, Download } from "lucide-react";
import { useState, useMemo } from "react";
import TopBar from "@/components/TopBar";
import { motion } from "framer-motion";
import { GeneratedImage } from "@/types";

function ExpirationTimer({ expiresAt }: { expiresAt: string }) {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / 86400000);

  if (daysLeft <= 0) return null;

  if (daysLeft <= 1) {
    return (
      <div className="mt-1 space-y-1">
        <p className="text-xs font-semibold text-red-500">{daysLeft} Day Left</p>
        <p className="text-[10px] text-red-400 leading-tight">
          Download pictures now before deleted for security reasons
        </p>
      </div>
    );
  }

  if (daysLeft <= 3) {
    return <p className="mt-1 text-xs font-semibold text-yellow-400">{daysLeft} Days Left</p>;
  }

  return <p className="mt-1 text-xs text-muted-foreground">{daysLeft} Days Left</p>;
}

export default function Gallery() {
  const [, setLocation] = useLocation();
  const { state: authState } = useAuth();
  const { state: generationState } = useGeneration();
  const [search, setSearch] = useState("");

  const filteredImages = useMemo(() => {
    const now = Date.now();
    const term = search.toLowerCase();

    return generationState.generatedImages.filter(img => {
      const notExpired = new Date(img.expires_at).getTime() > now;
      const matchesSearch = !term ||
        (img.title?.toLowerCase().includes(term)) ||
        img.url.toLowerCase().includes(term);
      return notExpired && matchesSearch;
    });
  }, [generationState.generatedImages, search]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar />
      <main className="container mx-auto pt-24 pb-12 px-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <Button
              variant="ghost"
              className="mb-4 -ml-4 text-muted-foreground hover:text-foreground"
              onClick={() => setLocation("/app")}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back to Designer
            </Button>
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="text-3xl font-bold"
            >
              Brand Gallery
            </motion.h1>
            <p className="text-sm text-muted-foreground mt-1">
              Showing all account concepts
            </p>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search concepts..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filteredImages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="relative flex flex-col items-center justify-center py-24 border-2 border-dashed border-primary/30 rounded-xl bg-muted/20 overflow-hidden"
          >
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: "200%" }}
              transition={{ duration: 1.4, ease: "easeInOut", delay: 0.3 }}
              className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent pointer-events-none"
            />
            <p className="text-foreground text-lg mb-4 font-semibold tracking-[0.04em]">No concepts found</p>
            <Button
              onClick={() => setLocation("/app")}
              className="h-[44px] border-2 border-primary/50 hover:border-primary hover:shadow-[0_0_12px_rgba(124,58,237,0.35)] transition-all duration-200 hover:scale-[1.03] ease-out"
            >
              Start Designing
            </Button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredImages.map((img: GeneratedImage) => (
              <motion.div
                key={img.generated_image_id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Card className="overflow-hidden group">
                  <CardContent className="p-0 relative aspect-square">
                    <img
                      src={img.url}
                      alt={img.title || "Logo concept"}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <Button
                        size="icon"
                        variant="secondary"
                        onClick={() => {
                          let url = img.url;
                          const title = img.title || 'Concept';
                          if (url.includes('res.cloudinary.com')) {
                            url = url.replace('/upload/', '/upload/fl_attachment/');
                          }
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${title.replace(/\s+/g, '-').toLowerCase()}.png`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        }}
                        className="hover:outline hover:outline-2 hover:outline-primary hover:shadow-[0_0_12px_rgba(124,58,237,0.35)] transition-all duration-200 hover:scale-[1.05]"
                        data-testid={`button-download-${img.generated_image_id}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <div className="mt-2 px-1">
                  {img.title && (
                    <p className="text-sm font-bold text-foreground truncate">{img.title}</p>
                  )}
                  <ExpirationTimer expiresAt={img.expires_at} />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

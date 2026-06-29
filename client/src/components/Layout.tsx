import { Link, useLocation } from "wouter";
import { Zap, Command, Menu } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const navItems = [
    { label: "Home", href: "/" },
    { label: "Features", href: "/features" }, // Placeholder links
    { label: "Docs", href: "/docs" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans selection:bg-primary/20">
      {/* Navbar */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group cursor-pointer">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-primary to-purple-400 flex items-center justify-center shadow-lg shadow-primary/25 transition-transform group-hover:scale-105 group-hover:rotate-3 duration-300">
              <Zap className="w-5 h-5 text-white fill-current" />
            </div>
            <span className="font-display font-bold text-lg tracking-tight text-foreground group-hover:text-primary transition-colors">
              EasyPeasy
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8">
            {navItems.map((item) => (
              <Link 
                key={item.href} 
                href={item.href}
                className={`text-sm font-medium transition-colors hover:text-primary ${
                  location === item.href ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <div className="w-px h-4 bg-border mx-2" />
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground font-mono text-xs">
              <Command className="w-3 h-3" /> K
            </Button>
            <Button size="sm" className="rounded-full px-5 bg-foreground text-background hover:bg-white/90">
              Get Started
            </Button>
          </nav>

          {/* Mobile Nav */}
          <div className="md:hidden">
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent className="border-border/50 bg-background/95 backdrop-blur-xl">
                <div className="flex flex-col gap-6 mt-8">
                  {navItems.map((item) => (
                    <Link 
                      key={item.href} 
                      href={item.href}
                      className="text-lg font-medium text-foreground/80 hover:text-primary transition-colors"
                      onClick={() => setIsOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                  <Button className="w-full mt-4 bg-primary hover:bg-primary/90">Get Started</Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 pt-16 relative overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-primary/20 blur-[120px] rounded-full opacity-20 pointer-events-none -z-10" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-blue-500/10 blur-[100px] rounded-full opacity-20 pointer-events-none -z-10" />

        <div className="container max-w-7xl mx-auto px-4 sm:px-6 py-8 md:py-12 animate-in-fade">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 py-8 md:py-12 bg-card/30">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
          <p>© 2024 EasyPeasy Inc. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            <a href="#" className="hover:text-foreground transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50 bg-card/50 backdrop-blur-xl shadow-2xl">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold font-display tracking-tight">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
            The page you are looking for doesn't exist or has been moved. 
            Check the URL or head back to the home page.
          </p>
          
          <div className="mt-8">
            <Link href="/">
              <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                Return to Home
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

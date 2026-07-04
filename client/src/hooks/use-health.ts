import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";

export function useHealth() {
  return useQuery({
    queryKey: [api.health.path],
    queryFn: async () => {
      const res = await fetch(api.health.path);
      if (!res.ok) throw new Error("Health check failed");
      return api.health.responses[200].parse(await res.json());
    },
    // Don't refetch too aggressively for a simple health check
    refetchInterval: 30000, 
  });
}

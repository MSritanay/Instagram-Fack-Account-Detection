import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Analysis } from "@/types/analysis";

// fetch all analyses (for history page)
export function useAnalyses() {
  return useQuery<Analysis[]>({
    queryKey: ["/api/analyses"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/analyses");
      return res.json();
    },
  });
}

// fetch a single analysis by id
export function useAnalysis(id: number) {
  return useQuery<Analysis | null>({
    queryKey: ["/api/analyses", id.toString()],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/analyses/${id}`);
      return res.json();
    },
    enabled: Number.isFinite(id),
  });
}

// create new analysis (profile or message)
export function useCreateAnalysis() {
  return useMutation({
    mutationFn: async (data: { contentType: string; content: string; url?: string }) => {
      const res = await apiRequest("POST", "/api/analyses", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analyses"] });
    },
  });
}

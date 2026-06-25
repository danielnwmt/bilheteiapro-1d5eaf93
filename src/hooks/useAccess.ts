import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccess } from "@/lib/access.functions";

export function useAccess() {
  const fetchAccess = useServerFn(getMyAccess);
  return useQuery({
    queryKey: ["my-access"],
    queryFn: () => fetchAccess(),
    staleTime: 30_000,
  });
}

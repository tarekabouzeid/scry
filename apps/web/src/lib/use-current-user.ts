"use client";

import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./api";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 1;
    },
  });
}

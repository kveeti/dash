import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import { importKeys } from "./imports";

export interface EnableBankingAccount {
  uid: string;
  iban: string;
  name: string;
  currency: string;
  bucket_id?: string;
  bucket_name?: string;
}

export interface EnableBankingConnection {
  id: string;
  bank: string;
  country: string;
  psu_type: "personal" | "business";
  expires_at: string;
  accounts: EnableBankingAccount[];
}

export const enableBankingKeys = {
  all: ["enable-banking"] as const,
  connections: ["enable-banking", "connections"] as const,
};

export function useEnableBankingConnections() {
  return useQuery({
    queryKey: enableBankingKeys.connections,
    queryFn: () =>
      api<EnableBankingConnection[]>("/api/v1/enablebanking/connections"),
  });
}

export function useMapEnableBankingAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      connectionId: string;
      accountUid: string;
      bucketId: string;
      bucketName: string;
      iban: string;
    }) =>
      api<void>(
        `/api/v1/enablebanking/connections/${input.connectionId}/accounts/${input.accountUid}/map`,
        { method: "POST", body: JSON.stringify({ bucket_id: input.bucketId }) },
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: enableBankingKeys.all });
      const previous = queryClient.getQueryData<EnableBankingConnection[]>(
        enableBankingKeys.connections,
      );
      queryClient.setQueryData<EnableBankingConnection[]>(
        enableBankingKeys.connections,
        (connections = []) =>
          connections.map((connection) =>
            connection.id !== input.connectionId
              ? connection
              : {
                  ...connection,
                  accounts: connection.accounts.map((account) =>
                    account.iban === input.iban
                      ? {
                          ...account,
                          bucket_id: input.bucketId,
                          bucket_name: input.bucketName,
                        }
                      : account,
                  ),
                },
          ),
      );
      return { previous };
    },
    onError: (_error, _input, context) =>
      queryClient.setQueryData(
        enableBankingKeys.connections,
        context?.previous,
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: enableBankingKeys.all }),
  });
}

export function useSyncEnableBankingAccounts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accounts: { connectionId: string; accountUid: string }[]) =>
      api<{ batch_ids: string[] }>("/api/v1/enablebanking/sync", {
        method: "POST",
        body: JSON.stringify({
          accounts: accounts.map((account) => ({
            connection_id: account.connectionId,
            account_uid: account.accountUid,
          })),
        }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: importKeys.all }),
  });
}

export function useDeleteEnableBankingConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/api/v1/enablebanking/connections/${id}`, {
        method: "DELETE",
      }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: enableBankingKeys.all });
      const previous = queryClient.getQueryData<EnableBankingConnection[]>(
        enableBankingKeys.connections,
      );
      queryClient.setQueryData<EnableBankingConnection[]>(
        enableBankingKeys.connections,
        (connections = []) =>
          connections.filter((connection) => connection.id !== id),
      );
      return { previous };
    },
    onError: (_error, _id, context) =>
      queryClient.setQueryData(
        enableBankingKeys.connections,
        context?.previous,
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: enableBankingKeys.all }),
  });
}

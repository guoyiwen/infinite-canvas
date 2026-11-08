import { create } from "zustand";

export type MohangKey = {
    id: number;
    name: string;
    groupName: string;
    imageEnabled: boolean;
    unavailableReason: string;
};

type MohangStore = {
    available: boolean;
    keys: MohangKey[];
    selectedId: number | undefined;
    connectedKey: MohangKey | null;
    loading: boolean;
    connecting: boolean;
    error: string;
};

// Key selection metadata stays separate from saved provider credentials.
export const useMohangStore = create<MohangStore>()(() => ({
    available: false,
    keys: [],
    selectedId: undefined,
    connectedKey: null,
    loading: false,
    connecting: false,
    error: "",
}));

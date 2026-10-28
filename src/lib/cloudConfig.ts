// Projet Supabase utilisé pour les comptes et la sauvegarde des decks.
// Ces deux valeurs sont publiques (la sécurité repose sur les règles RLS de supabase/schema.sql).
// Tant qu'elles sont vides, l'appli fonctionne uniquement en local, comme avant.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || "";
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_KEY || "sb_publishable_1zaaU34xHT0EqsWrPqSZrQ_qW8Ne3oQ";

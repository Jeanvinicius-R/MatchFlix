"use client";

import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { CandidateAdapterOption } from "@/features/admin/components/CandidateShared";

export type CandidateMethodFilter = "" | "strong" | "metadata";

export interface CandidateFilterValues {
  provider: string;
  minScore: string;
  method: CandidateMethodFilter;
}

interface CandidateFiltersProps {
  adapters: CandidateAdapterOption[];
  values: CandidateFilterValues;
  /** Page the plain GET form submits to (filters live in the URL). */
  action: string;
}

/** Plain GET form: the server page reads the filters from the query string. */
export function CandidateFilters({ adapters, values, action }: CandidateFiltersProps) {
  const knownProvider = adapters.some((adapter) => adapter.id === values.provider);

  return (
    <form
      // Remount on URL change so "Limpar" resets the uncontrolled fields.
      key={`${values.provider}|${values.minScore}|${values.method}`}
      method="get"
      action={action}
      aria-label="Filtrar candidatos"
      className="flex flex-wrap items-end gap-4"
    >
      <Select label="Provedor" name="provider" defaultValue={values.provider}>
        <option value="">Todos</option>
        {adapters.map((adapter) => (
          <option key={adapter.id} value={adapter.id}>
            {adapter.label}
          </option>
        ))}
        {values.provider && !knownProvider && (
          <option value={values.provider}>{values.provider}</option>
        )}
      </Select>
      <Input
        label="Nota mínima"
        name="minScore"
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        step={1}
        defaultValue={values.minScore}
        className="w-28"
      />
      <Select label="Método" name="method" defaultValue={values.method}>
        <option value="">Todos</option>
        <option value="strong">ID forte (TMDB/IMDb)</option>
        <option value="metadata">Metadados (título/ano)</option>
      </Select>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        <Link href={action} className={buttonStyles("ghost")}>
          Limpar
        </Link>
      </div>
    </form>
  );
}

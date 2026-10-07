"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { buttonStyles } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface FileUploadButtonProps {
  /** Endpoint that accepts the raw file as the request body. */
  uploadUrl: string;
  accept: string;
  label: string;
  /** Shown after a successful upload. */
  successMessage?: string;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}

type Status =
  | { state: "idle" }
  | { state: "uploading"; percent: number | null }
  | { state: "done"; text: string; isError: boolean };

/**
 * Sends one file as the raw request body (no multipart), with upload progress
 * — XMLHttpRequest because fetch() cannot report upload progress. Validation
 * (type, signature, size) happens on the server; `accept` is only a hint.
 */
export function FileUploadButton({
  uploadUrl,
  accept,
  label,
  successMessage = "Arquivo enviado.",
  variant = "secondary",
  className,
}: FileUploadButtonProps) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ state: "idle" });

  function upload(file: File) {
    setStatus({ state: "uploading", percent: 0 });

    const request = new XMLHttpRequest();
    request.open("POST", uploadUrl);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));

    request.upload.onprogress = (event) => {
      setStatus({
        state: "uploading",
        percent: event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null,
      });
    };
    request.onload = () => {
      let error: string | null = null;
      if (request.status < 200 || request.status >= 300) {
        try {
          error = (JSON.parse(request.responseText) as { error?: string }).error ?? null;
        } catch {
          error = null;
        }
        error ??= `Falha no envio (HTTP ${request.status}).`;
      }
      setStatus({ state: "done", text: error ?? successMessage, isError: Boolean(error) });
      if (!error) {
        router.refresh();
      }
    };
    request.onerror = () => {
      setStatus({ state: "done", text: "Falha de rede durante o envio.", isError: true });
    };
    request.send(file);
  }

  const isUploading = status.state === "uploading";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={inputId}
        className={cn(
          buttonStyles(variant),
          "cursor-pointer",
          isUploading && "pointer-events-none opacity-50",
        )}
      >
        {isUploading
          ? `Enviando${status.percent !== null ? ` ${status.percent}%` : "..."}`
          : label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        disabled={isUploading}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            upload(file);
          }
        }}
      />
      {status.state === "done" && (
        <p
          role={status.isError ? "alert" : "status"}
          className={cn("text-xs", status.isError ? "text-danger" : "text-accent")}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}

import { NextResponse } from "next/server";
import { UploadError, type UploadRequest } from "@/services/upload.service";

/** Reads what the upload service needs from a raw-body upload (`fetch(url, { body: file })`). */
export function toUploadRequest(request: Request): UploadRequest {
  const length = Number(request.headers.get("content-length"));
  const rawName = request.headers.get("x-file-name");
  let fileName: string | null = null;
  try {
    fileName = rawName ? decodeURIComponent(rawName) : null;
  } catch {
    fileName = null;
  }
  return {
    contentType: request.headers.get("content-type"),
    contentLength: Number.isFinite(length) && length > 0 ? length : null,
    fileName,
    body: request.body,
  };
}

/** Upload failures become JSON errors with the right status; anything else is a 500. */
export function uploadErrorResponse(error: unknown): NextResponse {
  if (error instanceof UploadError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Falha no upload:", error);
  return NextResponse.json({ error: "Não foi possível salvar o arquivo." }, { status: 500 });
}

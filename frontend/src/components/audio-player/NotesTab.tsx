import React, { useState, useEffect, useRef } from "react";
import {
  NotebookPen,
  RefreshCw,
  Check,
  Copy,
  Sparkles,
  Pencil,
  Save,
  X,
  BookOpen,
} from "lucide-react";
import { ToastContainer, type ToastMessage } from "../FileExplorer/Toast";
import { FailedStateContainer } from "../common/FailedStateContainer";
import { SavedContentLoader, SavedContentReveal, holdSavedContentLoader } from "../common/SavedContentLoader";
import InlineCitationContent from "../rag/InlineCitationContent";
import { NotesEditor } from "../common/NotesEditor";

interface NotesTabProps {
  resourceId: string | null;
  token: string | null;
  onSeek?: (time: number) => void;
  initialNotes?: string | null;
  onNotesGenerated?: (notes: string) => void;
}

export default function NotesTab({ resourceId, token, onSeek, initialNotes, onNotesGenerated }: NotesTabProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMode, setLoadingMode] = useState<"saved" | "generate" | null>(
    initialNotes !== undefined
      ? (initialNotes ? "saved" : "generate")
      : "saved"
  );
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedNotes, setEditedNotes] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [savingToNotebook, setSavingToNotebook] = useState<boolean>(false);
  const [savedToNotebook, setSavedToNotebook] = useState<boolean>(false);
  const [hasSavedThisGeneration, setHasSavedThisGeneration] = useState<boolean>(false);
  const [wasSavedLoad, setWasSavedLoad] = useState<boolean>(false);
  const isFetchingRef = useRef<boolean>(false);
  const isSavingRef = useRef<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);

  const addToast = (text: string, type: ToastMessage["type"] = "info") => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
  };

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const handleSaveToNotebook = async () => {
    if (!resourceId || !token) return;
    if (hasSavedThisGeneration || isSavingRef.current) return;
    isSavingRef.current = true;
    setSavingToNotebook(true);
    try {
      const res = await fetch(`/api/resources/${resourceId}/save-to-notebook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ notes: notes }),
      });
      if (!res.ok) {
        const errData = await res.json();
        const errMsg = errData.detail || "Failed to save notes to notebook";
        if (errMsg.toLowerCase().includes("already saved")) {
          setSavedToNotebook(true);
          setHasSavedThisGeneration(true);
          setTimeout(() => setSavedToNotebook(false), 2000);
          return;
        }
        throw new Error(errMsg);
      }
      setSavedToNotebook(true);
      setHasSavedThisGeneration(true);
      setTimeout(() => setSavedToNotebook(false), 2000);
      window.dispatchEvent(new CustomEvent("refresh-notebook-notes"));
    } catch (err: any) {
      console.error(err);
      isSavingRef.current = false;
      addToast(err.message || "Failed to save notes to notebook", "error");
    } finally {
      setSavingToNotebook(false);
    }
  };

  const fetchNotes = async (forceRegenerate = false) => {
    if (!resourceId || !token) return;
    if (!forceRegenerate && isFetchingRef.current) return;
    isFetchingRef.current = true;

    setLoading(true);
    setLoadingMode(forceRegenerate ? "generate" : "saved");
    setWasSavedLoad(!forceRegenerate);
    setError(null);
    setHasSavedThisGeneration(false);
    isSavingRef.current = false;

    try {
      if (!forceRegenerate) {
        const savedLoadStartedAt = Date.now();

        if (initialNotes) {
          await holdSavedContentLoader(savedLoadStartedAt);
          setNotes(initialNotes);
          setLoading(false);
          isFetchingRef.current = false;
          return;
        }

        if (initialNotes === null) {
          setLoadingMode("generate");
        } else {
          const getRes = await fetch(`/resources/${resourceId}/notes`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (getRes.ok) {
            const getData = await getRes.json();
            if (getData.notes && getData.notes.trim()) {
              await holdSavedContentLoader(savedLoadStartedAt);
              setNotes(getData.notes);
              setLoading(false);
              isFetchingRef.current = false;
              return;
            }
          }
          setLoadingMode("generate");
        }
        const postRes = await fetch(`/resources/${resourceId}/generate-notes`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!postRes.ok) throw new Error("Failed to generate notes.");
        const data = await postRes.json();
        const notesText = data.notes || "No notes returned.";
        setNotes(notesText);
        onNotesGenerated?.(notesText);
      } else {
        const postRes = await fetch(
          `/resources/${resourceId}/regenerate-notes`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (!postRes.ok) throw new Error("Failed to regenerate notes.");
        const data = await postRes.json();
        const notesText = data.notes || "No notes returned.";
        setNotes(notesText);
        onNotesGenerated?.(notesText);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    if (resourceId && token) {
      fetchNotes();
    }
  }, [resourceId, token]);

  useEffect(() => {
    setHasSavedThisGeneration(false);
    isSavingRef.current = false;
  }, [notes]);

  const handleCopy = () => {
    navigator.clipboard.writeText(notes);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    if (!resourceId || !token) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/resources/${resourceId}/notes`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ notes: editedNotes }),
      });
      if (!res.ok) throw new Error("Failed to save notes");
      const data = await res.json();
      setNotes(data.notes);
      setIsEditing(false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to save notes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#1D1D1F] flex items-center justify-center shadow-sm">
            <NotebookPen className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-[#1D1D1F] leading-none">
              Deep Study Notes
            </h2>
            <p className="text-xs text-[#8E8E93] mt-0.5">
              AI-generated comprehensive notes
            </p>
          </div>
        </div>

        {notes && !loading && (
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                <button
                  onClick={handleSaveToNotebook}
                  disabled={savingToNotebook || hasSavedThisGeneration}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-[#585859] hover:bg-[#ECEAEB] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:text-[#8E8E93] disabled:hover:bg-transparent"
                  title={hasSavedThisGeneration ? "Saved" : "Save to Notebook"}
                >
                  {savingToNotebook ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : hasSavedThisGeneration ? (
                    <Check className="w-3.5 h-3.5 text-slate-400" />
                  ) : savedToNotebook ? (
                    <Check className="w-3.5 h-3.5 text-green-600" />
                  ) : (
                    <BookOpen className="w-3.5 h-3.5" />
                  )}
                  {hasSavedThisGeneration ? "Saved" : savedToNotebook ? "Saved!" : "Save to notebook"}
                </button>
                <button
                  onClick={() => {
                    setEditedNotes(notes);
                    setIsEditing(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-[#585859] hover:bg-[#ECEAEB] transition cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-[#585859] hover:bg-[#ECEAEB] transition cursor-pointer"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-green-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={() => fetchNotes(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-[#585859] hover:bg-[#ECEAEB] transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Regenerate
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-[#585859] hover:bg-[#ECEAEB] transition cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-white bg-[#1D1D1F] hover:bg-black transition cursor-pointer disabled:opacity-50"
                >
                  {saving ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        loadingMode === "saved" ? (
          <SavedContentLoader message="Opening your saved notes..." />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center space-y-4">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 rounded-full border-2 border-neutral-200" />
              <div className="absolute inset-0 rounded-full border-2 border-[#1D1D1F] border-t-transparent animate-spin" />
              <div className="absolute inset-2 flex items-center justify-center">
                <NotebookPen className="w-4 h-4 text-[#1D1D1F]" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-[#1D1D1F]">
                Generating deep notes…
              </p>
              <p className="text-xs text-[#8E8E93] mt-1 max-w-xs">
                AI is reading all chapters and building comprehensive study notes.
              </p>
            </div>
          </div>
        )
      ) : error ? (
        <FailedStateContainer message={error} onRetry={() => fetchNotes(true)} title="Failed to load Notes" />
      ) : notes ? (
        wasSavedLoad ? (
          <SavedContentReveal>
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden rounded-2xl border border-neutral-100/80 dark:border-white/10">
              {isEditing ? (
                <NotesEditor
                  value={editedNotes}
                  onChange={setEditedNotes}
                  className="flex-1 min-h-[400px]"
                />
              ) : (
                <div className="flex-1 overflow-y-auto no-scrollbar bg-neutral-50/50 dark:bg-slate-800/50 p-6 leading-relaxed">
                  <InlineCitationContent text={notes} onSeek={onSeek} />
                </div>
              )}
            </div>
          </SavedContentReveal>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden rounded-2xl border border-neutral-100/80 dark:border-white/10">
            {isEditing ? (
              <NotesEditor
                value={editedNotes}
                onChange={setEditedNotes}
                className="flex-1 min-h-[400px]"
              />
            ) : (
              <div className="flex-1 overflow-y-auto no-scrollbar bg-neutral-50/50 dark:bg-slate-800/50 p-6 leading-relaxed">
                <InlineCitationContent text={notes} onSeek={onSeek} />
              </div>
            )}
          </div>
        )
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-neutral-100 flex items-center justify-center mb-4">
            <Sparkles className="w-6 h-6 text-neutral-500" />
          </div>
          <p className="text-base font-bold text-[#1D1D1F] mb-1">
            Ready to build deep notes
          </p>
          <p className="text-sm text-[#8E8E93] max-w-sm mx-auto mb-6">
            AI will analyze every chapter and generate thorough, structured
            study notes with concepts, breakdowns, workflows, and examples.
          </p>
          <button
            onClick={() => fetchNotes(false)}
            className="px-6 py-2.5 bg-[#1D1D1F] hover:bg-neutral-700 text-white font-bold text-sm rounded-full transition cursor-pointer"
          >
            Generate Deep Notes
          </button>
        </div>
      )}
    </div>
  );
}

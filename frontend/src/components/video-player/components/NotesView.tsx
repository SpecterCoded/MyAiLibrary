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
import { ToastContainer, type ToastMessage } from "../../FileExplorer/Toast";
import { FailedStateContainer } from "../../common/FailedStateContainer";
import { SavedContentLoader, SavedContentReveal, holdSavedContentLoader } from "../../common/SavedContentLoader";
import InlineCitationContent from "../../rag/InlineCitationContent";
import { NotesEditor } from "../../common/NotesEditor";

interface NotesViewProps {
  resourceId: string | null;
  token: string | null;
  onSeek?: (time: number) => void;
  initialNotes?: string | null;
  onNotesGenerated?: (notes: string) => void;
}

export function NotesView({ resourceId, token, onSeek, initialNotes, onNotesGenerated }: NotesViewProps) {
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
  const [wasSavedLoad, setWasSavedLoad] = useState<boolean>(false);
  const isFetchingRef = useRef<boolean>(false);
  const [hasSavedThisGeneration, setHasSavedThisGeneration] = useState<boolean>(false);
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
        if (!postRes.ok) {
          throw new Error("Failed to generate notes. Server may be starting.");
        }
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
        if (!postRes.ok) {
          throw new Error("Failed to regenerate notes.");
        }
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
    <div className="flex-1 flex flex-col px-6 pb-24 min-h-0 bg-white dark:bg-[#1e1f22]">
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#ff7d54] to-[#ff5733] flex items-center justify-center shadow-sm">
            <NotebookPen className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800 font-display leading-none">
              Deep Study Notes
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              AI-generated comprehensive notes
            </p>
          </div>
        </div>

        {notes && !loading && (
          <div className="flex items-center space-x-2">
            {!isEditing ? (
              <>
                <button
                  onClick={handleSaveToNotebook}
                  disabled={savingToNotebook || hasSavedThisGeneration}
                  className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 disabled:hover:bg-transparent disabled:text-slate-300 transition flex items-center space-x-1.5 text-sm font-bold cursor-pointer disabled:cursor-not-allowed"
                  title={hasSavedThisGeneration ? "Saved" : "Save to Notebook"}
                >
                  {savingToNotebook ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : hasSavedThisGeneration ? (
                    <Check className="w-4 h-4 text-slate-400" />
                  ) : savedToNotebook ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <BookOpen className="w-4 h-4" />
                  )}
                  <span>
                    {hasSavedThisGeneration
                      ? "Saved"
                      : savedToNotebook
                      ? "Saved!"
                      : "Save to notebook"}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setEditedNotes(notes);
                    setIsEditing(true);
                  }}
                  className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition flex items-center space-x-1.5 text-sm font-bold cursor-pointer"
                  title="Edit Notes"
                >
                  <Pencil className="w-4 h-4" />
                  <span>Edit</span>
                </button>
                <button
                  onClick={handleCopy}
                  className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition flex items-center space-x-1.5 text-sm font-bold cursor-pointer"
                  title="Copy Notes"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
                <button
                  onClick={() => fetchNotes(true)}
                  className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition flex items-center space-x-1.5 text-sm font-bold cursor-pointer"
                  title="Regenerate Notes"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Regenerate</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsEditing(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition flex items-center space-x-1.5 text-sm font-bold cursor-pointer"
                >
                  <X className="w-4 h-4" />
                  <span>Cancel</span>
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="p-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition flex items-center space-x-1.5 text-sm font-bold cursor-pointer disabled:opacity-50"
                >
                  {saving ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{saving ? "Saving..." : "Save"}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Content area */}
      {loading ? (
        loadingMode === "saved" ? (
          <SavedContentLoader message="Opening your saved notes..." />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center space-y-5 py-20">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-2 border-[#ff7d54]/20" />
              <div className="absolute inset-0 rounded-full border-2 border-[#ff7d54] border-t-transparent animate-spin" />
              <div className="absolute inset-2 rounded-full bg-gradient-to-br from-[#ff7d54]/10 to-transparent flex items-center justify-center">
                <NotebookPen className="w-4 h-4 text-[#ff7d54]" />
              </div>
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-base font-bold text-slate-800">
                Generating deep notes...
              </p>
              <p className="text-sm text-slate-400 max-w-xs mx-auto">
                AI is reading through all chapters and building comprehensive study notes.
              </p>
            </div>
          </div>
        )
      ) : error ? (
        <FailedStateContainer message={error} onRetry={() => fetchNotes(true)} title="Failed to load Notes" />
      ) : notes ? (
        wasSavedLoad ? (
          <SavedContentReveal>
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden rounded-2xl border border-slate-100/80 dark:border-white/10">
              {isEditing ? (
                <NotesEditor
                  value={editedNotes}
                  onChange={setEditedNotes}
                  className="flex-1 min-h-[400px]"
                />
              ) : (
                <div className="flex-1 overflow-y-auto no-scrollbar bg-slate-50/50 dark:bg-slate-800/50 p-7 leading-relaxed">
                  <InlineCitationContent text={notes} onSeek={onSeek} />
                </div>
              )}
            </div>
          </SavedContentReveal>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden rounded-2xl border border-slate-100/80 dark:border-white/10">
            {isEditing ? (
              <NotesEditor
                value={editedNotes}
                onChange={setEditedNotes}
                className="flex-1 min-h-[400px]"
              />
            ) : (
              <div className="flex-1 overflow-y-auto no-scrollbar bg-slate-50/50 dark:bg-slate-800/50 p-7 leading-relaxed">
                <InlineCitationContent text={notes} onSeek={onSeek} timestampClassName="inline-flex h-6 items-center justify-center px-2 py-0.5 mx-0.5 rounded-md border border-indigo-200/60 bg-indigo-50 text-[11px] font-extrabold text-indigo-700 shadow-sm align-middle cursor-pointer select-none whitespace-nowrap hover:bg-indigo-100 transition" />
              </div>
            )}
          </div>
        )
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#ff7d54]/10 to-[#ff7d54]/5 flex items-center justify-center mb-4 border border-[#ff7d54]/10">
            <Sparkles className="w-7 h-7 text-[#ff7d54]" />
          </div>
          <p className="text-lg font-bold text-slate-700 mb-1">
            Ready to create deep notes
          </p>
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
            AI will analyze every chapter and generate thorough, structured
            study notes with key concepts, breakdowns, and examples.
          </p>
          <button
            onClick={() => fetchNotes(false)}
            className="px-6 py-2.5 bg-gradient-to-br from-[#ff7d54] to-[#ff5733] hover:brightness-110 text-white font-bold text-sm rounded-full transition shadow-sm cursor-pointer"
          >
            Generate Deep Notes
          </button>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  X,
  Video,
  FileText,
  File,
  Image as ImageIcon,
  Book,
  Link as LinkIcon,
  BookOpen,
  ArrowRight,
  Lightbulb,
  Loader2,
} from "lucide-react";

interface SearchModalProps {
  sourceNodeId: string;
  onClose: () => void;
  onLink: (
    sourceId: string,
    item: any,
    linkType: "contain" | "reference",
  ) => void;
}

interface SearchItem {
  id: string;
  title: string;
  type: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  video: <Video className="w-4 h-4" />,
  pdf: <FileText className="w-4 h-4" />,
  docx: <File className="w-4 h-4" />,
  image: <ImageIcon className="w-4 h-4" />,
  note: <BookOpen className="w-4 h-4" />,
  chapter: <Book className="w-4 h-4" />,
  "sub-chapter": <Book className="w-4 h-4" />,
  subchapter: <Book className="w-4 h-4" />,
  concept: <Lightbulb className="w-4 h-4" />,
  attachment: <File className="w-4 h-4" />,
};

export default function SearchModal({
  sourceNodeId,
  onClose,
  onLink,
}: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // apiFetch helper
  const apiFetch = async (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem("access_token");
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    };
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response;
  };

  useEffect(() => {
    let active = true;
    const fetchResults = async () => {
      setLoading(true);
      try {
        const res = await apiFetch(`/search?query=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!active) return;

        const items: SearchItem[] = [];

        if (data.resources) {
          data.resources.forEach((r: any) => {
            const t = (r.type || "").toLowerCase();
            if (t === "video" || t === "audio" || t === "pdf") {
              items.push({
                id: r.id,
                title: r.title || "Untitled Resource",
                type: t,
              });
            }
          });
        }

        if (data.chapters) {
          data.chapters.forEach((c: any) => {
            items.push({
              id: c.id,
              title: c.title || "Untitled Chapter",
              type: "chapter",
            });
          });
        }

        if (data.notes) {
          data.notes.forEach((n: any) => {
            items.push({
              id: n.id,
              title: n.title || "Untitled Note",
              type: "note",
            });
          });
        }

        setResults(items);
      } catch (err) {
        console.error("Error searching library:", err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    const delayDebounce = setTimeout(() => {
      fetchResults();
    }, 200);

    return () => {
      active = false;
      clearTimeout(delayDebounce);
    };
  }, [query, sourceNodeId]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT") {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (results[selectedIndex]) {
            onLink(sourceNodeId, results[selectedIndex], e.ctrlKey || e.metaKey ? "contain" : "reference");
          }
        }
      } else {
        if (e.key === "c" || e.key === "C") {
          e.preventDefault();
          if (results[selectedIndex]) {
            onLink(sourceNodeId, results[selectedIndex], "contain");
          }
        } else if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          if (results[selectedIndex]) {
            onLink(sourceNodeId, results[selectedIndex], "reference");
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [results, selectedIndex, onLink, sourceNodeId, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="bg-white w-[550px] shadow-2xl flex flex-col font-sans rounded-xl overflow-hidden border border-[#e9e9e7] cmdk-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-3.5 border-b border-[#e9e9e7]">
          <Search className="w-5 h-5 text-[#888]" />
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search library..."
            className="flex-1 bg-transparent border-none outline-none text-[16px] text-[#37352f] placeholder-[#9b9a97]"
          />
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#efefed] rounded transition-colors text-[#888]"
          >
            <kbd className="font-mono text-[10px] uppercase font-semibold">
              ESC
            </kbd>
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto max-h-[50vh] p-1.5 min-h-[300px] scrollbar-thin">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-[#888]">
              <Loader2 className="w-8 h-8 animate-spin text-[#3B82F6] mb-2" />
              <span className="text-[14px]">Searching library...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="text-center text-[#9b9a97] py-14 text-[14px]">
              No materials found for "{query}"
            </div>
          ) : (
            <div className="space-y-0.5">
              {results.map((item, i) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-2.5 rounded-lg group transition-colors cursor-pointer ${selectedIndex === i ? "bg-[#efefed]" : "hover:bg-[#f7f7f5]"}`}
                  onMouseMove={() => setSelectedIndex(i)}
                  onClick={() => onLink(sourceNodeId, item, "reference")}
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-white border border-[#e9e9e7] w-8 h-8 rounded-md flex items-center justify-center text-[#888] shadow-sm">
                      {TYPE_ICONS[item.type] || <File className="w-4 h-4" />}
                    </div>
                    <div>
                      <div
                        className={`text-[14px] font-medium leading-tight ${selectedIndex === i ? "text-[#37352f]" : "text-[#5a5a56]"}`}
                      >
                        {item.title}
                      </div>
                      <div className="text-[12px] text-[#9b9a97] capitalize mt-0.5">
                        {item.type}
                      </div>
                    </div>
                  </div>
                  {selectedIndex === i && (
                    <div className="flex items-center gap-2 text-[11px] text-[#888] font-medium animate-in fade-in zoom-in duration-200">
                      <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 border border-[#e9e9e7] bg-white rounded shadow-sm">
                          Enter
                        </kbd>{" "}
                        Ref
                      </span>
                      <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 border border-[#e9e9e7] bg-white rounded shadow-sm">
                          ⌘+Enter
                        </kbd>{" "}
                        Contain
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


import React, { useState, useEffect, useRef } from 'react';

interface UploadModalProps {
   isOpen: boolean;
   onClose: () => void;
   initialFiles: File[];
   onUpload?: (files: File[]) => Promise<void>;
}

const isAllowedFileType = (file: File): boolean => {
   const name = file.name.toLowerCase();
   const type = file.type.toLowerCase();

   // Extension checks
   const isPdf = name.endsWith('.pdf') || type === 'application/pdf';
   const isDocx = name.endsWith('.docx') || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
   const isImage = type.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].some(ext => name.endsWith(ext));
   const isAudio = type.startsWith('audio/') || ['.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a'].some(ext => name.endsWith(ext));
   const isVideo = type.startsWith('video/') || ['.mp4', '.mkv', '.avi', '.mov', '.webm'].some(ext => name.endsWith(ext));
   const isMd = name.endsWith('.md') || type === 'text/markdown';

   return isPdf || isDocx || isImage || isAudio || isVideo || isMd;
};

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, initialFiles, onUpload }) => {
   const [files, setFiles] = useState<File[]>([]);
   const [isDraggingOverZone, setIsDraggingOverZone] = useState(false);
   const [isUploading, setIsUploading] = useState(false);
   const [errorMessage, setErrorMessage] = useState<string | null>(null);
   const dialogRef = useRef<HTMLDivElement>(null);

   useEffect(() => {
      if (!isOpen) {
         setFiles([]);
         setErrorMessage(null);
      }
   }, [isOpen]);

   const processFiles = (incomingFiles: File[]) => {
      setErrorMessage(null);
      const valid: File[] = [];
      const invalid: string[] = [];

      incomingFiles.forEach(f => {
         if (isAllowedFileType(f)) {
            valid.push(f);
         } else {
            invalid.push(f.name);
         }
      });

      if (invalid.length > 0) {
         setErrorMessage(`Unsupported files ignored: ${invalid.join(', ')}. Only video, audio, image, PDF, DOCX, and Markdown are allowed.`);
      }

      if (valid.length > 0) {
         setFiles(prev => {
             const merged = [...prev];
             valid.forEach(vf => {
                 if (!merged.some(f => f.name === vf.name && f.size === vf.size)) {
                     merged.push(vf);
                 }
             });
             return merged;
         });
      }
   };

   useEffect(() => {
      if (initialFiles && initialFiles.length > 0) {
         processFiles(initialFiles);
      }
   }, [initialFiles]);

   const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
         processFiles(Array.from(e.target.files));
      }
   };

   const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingOverZone(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
         processFiles(Array.from(e.dataTransfer.files));
      }
   };

   const handleRemoveFile = (indexToRemove: number) => {
      setFiles(prev => prev.filter((_, index) => index !== indexToRemove));
   };

   const handleConfirmUpload = async () => {
      if (files.length === 0) return;
      setIsUploading(true);
      try {
         if (onUpload) {
            await onUpload(files);
         }
         setFiles([]);
         onClose();
      } catch (error) {
         console.error("Upload error:", error);
         setErrorMessage("Upload failed. Please check the backend connection.");
      } finally {
         setIsUploading(false);
      }
   };

   // Accessibility: ESC key and Tab Trapping
   useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
         if (!isOpen) return;

         if (e.key === "Escape") onClose();

         if (e.key === "Tab" && dialogRef.current) {
            const focusable = dialogRef.current.querySelectorAll(
               "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
            );
            if (!focusable) return;
            const first = focusable[0] as HTMLElement;
            const last = focusable[focusable.length - 1] as HTMLElement;

            if (e.shiftKey && document.activeElement === first) {
               e.preventDefault();
               last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
               e.preventDefault();
               first.focus();
            }
         }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => {
         document.removeEventListener("keydown", handleKeyDown);
      };
   }, [isOpen, onClose]);

   return (
      <div
         id="modalOverlay"
         className={`fixed inset-0 p-4 flex flex-wrap justify-center items-center w-full h-full z-[1000] before:fixed before:inset-0 before:w-full before:h-full before:bg-[rgba(0,0,0,0.5)] transition-opacity duration-300 ${!isOpen ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      >
         <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            tabIndex={-1}
            className={`w-full max-w-lg bg-white border border-slate-100 shadow-lg rounded-lg relative max-h-[95vh] overflow-y-auto outline-none p-4 md:p-6 transition-transform duration-300 ${isOpen ? "scale-100" : "scale-95"}`}
         >
            <div className="flex items-start pb-3 border-b border-slate-300">
               <div>
                  <h3 id="modal-title" className="text-slate-900 text-lg font-semibold flex-1">
                     Upload Files
                  </h3>
                  <p className="text-slate-600 text-sm mt-1.5">Confirm upload (Only PDF, Image, Audio, Video, DOCX, Markdown)</p>
               </div>

               <button
                  type="button"
                  aria-label="Close modal"
                  onClick={onClose}
                  className="ml-auto flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
               >
                  <svg xmlns="http://www.w3.org/2000/svg" className="size-3 cursor-pointer fill-slate-500 hover:fill-red-600" aria-hidden="true" viewBox="0 0 329.269 329">
                     <path d="M194.8 164.77 323.013 36.555c8.343-8.34 8.343-21.825 0-30.164-8.34-8.34-21.825-8.34-30.164 0L164.633 134.605 36.422 6.391c-8.344-8.34-21.824-8.34-30.164 0-8.344 8.34-8.344 21.824 0 30.164l128.21 128.215L6.259 292.984c-8.344 8.34-8.344 21.825 0 30.164a21.27 21.27 0 0 0 15.082 6.25c5.46 0 10.922-2.09 15.082-6.25l128.21-128.214 128.216 128.214a21.27 21.27 0 0 0 15.082 6.25c5.46 0 10.922-2.09 15.082-6.25 8.343-8.34 8.343-21.824 0-30.164zm0 0" />
                  </svg>
               </button>
            </div>

            <div className="mt-6">
                    <div 
                       onDragOver={(e) => { e.preventDefault(); setIsDraggingOverZone(true); }}
                       onDragLeave={() => setIsDraggingOverZone(false)}
                       onDrop={handleDrop}
                       className={`rounded-md border-2 border-dashed mt-6 transition-all duration-300 group ${isDraggingOverZone ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-500 hover:bg-blue-50'}`}
                    >
                       <div className="p-4 min-h-[160px] flex flex-col items-center justify-center text-center pointer-events-none">
                          <svg xmlns="http://www.w3.org/2000/svg" className={`size-10 mb-4 transition-colors ${isDraggingOverZone ? 'fill-blue-500' : 'fill-slate-400 group-hover:fill-blue-500'}`}
                             viewBox="0 0 32 32" aria-hidden="true">
                             <path
                                d="M23.75 11.044a7.99 7.99 0 0 0-15.5-.009A8 8 0 0 0 9 27h3a1 1 0 0 0 0-2H9a6 6 0 0 1-.035-12 1.038 1.038 0 0 0 1.1-.854 5.991 5.991 0 0 1 11.862 0A1.08 1.08 0 0 0 23 13a6 6 0 0 1 0 12h-3a1 1 0 0 0 0 2h3a8 8 0 0 0 .75-15.956z"
                                data-original="#000000" />
                             <path
                                d="M20.293 19.707a1 1 0 0 0 1.414-1.414l-5-5a1 1 0 0 0-1.414 0l-5 5a1 1 0 0 0 1.414 1.414L15 16.414V29a1 1 0 0 0 2 0V16.414z"
                                data-original="#000000" />
                          </svg>

                          <span className="flex justify-center flex-wrap gap-1 text-sm text-slate-600">
                             Drag & Drop or
                             <label className="text-blue-700 cursor-pointer pointer-events-auto">
                                <span>Choose files</span>
                                <input type="file" className="sr-only" multiple accept="video/*,audio/*,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.md" onChange={handleFileChange} />
                             </label>
                             to upload
                          </span>
                       </div>
                    </div>

               {errorMessage && (
                  <p className="text-red-500 text-xs mt-3 text-center font-medium bg-red-50 p-2 rounded border border-red-100">{errorMessage}</p>
               )}

               {files.map((f, index) => (
                  <div key={index} className="flex flex-col bg-gray-50 p-4 rounded-md mt-4 animate-fadeInDown">
                     <div className="flex">
                        <div className="flex items-center gap-1 text-xs text-slate-600 flex-1">
                           <span>{f.name} <span className="ml-2">{(f.size / 1024 / 1024).toFixed(2)} MB</span></span>
                        </div>
                        <button
                           type="button"
                           aria-label="remove file"
                           disabled={isUploading}
                           onClick={() => handleRemoveFile(index)}
                           className="text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50"
                        >
                           <svg xmlns="http://www.w3.org/2000/svg" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                           </svg>
                        </button>
                     </div>

                     <div className="bg-gray-200 rounded-full w-full h-2 my-2.5 overflow-hidden">
                        <div 
                           className={`h-full bg-blue-600 transition-all duration-500 ${isUploading ? 'animate-pulse' : ''}`} 
                           style={{ width: isUploading ? "100%" : "0%" }}
                        ></div>
                     </div>

                     <p className="text-xs text-slate-600 flex-1">{isUploading ? "Uploading..." : "Ready to upload"}</p>
                  </div>
               ))}
            </div>

            <div className="mt-6 flex gap-4 max-sm:flex-col">
               <button
                  type="button"
                  onClick={onClose}
                  disabled={isUploading}
                  className="px-3.5 py-2 text-slate-900 text-sm font-semibold w-full rounded-md cursor-pointer bg-white border border-slate-300 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
               >
                  Cancel
               </button>
               <button
                  type="button"
                  onClick={handleConfirmUpload}
                  disabled={isUploading || files.length === 0}
                  className="px-3.5 py-2 text-white text-sm font-semibold w-full rounded-md cursor-pointer bg-blue-600 border border-blue-600 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 max-sm:-order-1 disabled:opacity-50 flex items-center justify-center gap-2"
               >
                  {isUploading ? (
                     <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        Uploading...
                     </>
                  ) : "Upload"}
               </button>
            </div>
         </div>
      </div>
   );
};


import React from 'react'
import { createRoot } from 'react-dom/client'
import AttachmentViewer from 'attachment-viewer-design'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AttachmentViewer />
  </React.StrictMode>,
)

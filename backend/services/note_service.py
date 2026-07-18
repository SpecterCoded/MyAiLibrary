import os
import uuid
import datetime
import re
from sqlalchemy.orm import Session
from models import Note, Playlist, User
from core.logger import get_logger
from core.config import get_upload_path
from fastapi import HTTPException

logger = get_logger(__name__)

def _sanitize_filename(title: str) -> str:
    """Sanitizes a string to be used as a valid filename."""
    # Replace spaces with hyphens
    filename = title.replace(" ", "-")
    # Remove characters that are not alphanumeric, hyphens, or periods
    filename = re.sub(r"[^a-zA-Z0-9-.]", "", filename)
    # Remove leading/trailing hyphens
    filename = filename.strip("-")
    # Avoid empty filenames
    if not filename:
        filename = "untitled"
    return filename

import json

def blocks_to_markdown(content_json: str) -> str:
    if not content_json:
        return ""
    try:
        blocks = json.loads(content_json)
        if not isinstance(blocks, list):
            return content_json
    except Exception:
        # If not JSON, it might be plain text or markdown already
        return content_json

    md_lines = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        b_type = block.get("type", "paragraph")
        props = block.get("props", {})
        content = block.get("content", "")
        
        text_content = ""
        if isinstance(content, str):
            text_content = content
        elif isinstance(content, list):
            for inline in content:
                if isinstance(inline, dict) and inline.get("type") == "text":
                    text = inline.get("text", "")
                    styles = inline.get("styles", {})
                    if styles.get("bold"):
                        text = f"**{text}**"
                    if styles.get("italic"):
                        text = f"*{text}*"
                    text_content += text
                elif isinstance(inline, str):
                    text_content += inline
        
        if b_type == "heading":
            level = props.get("level", 1)
            md_lines.append(f"{'#' * level} {text_content}")
        elif b_type == "bulletListItem":
            md_lines.append(f"- {text_content}")
        elif b_type == "numberedListItem":
            md_lines.append(f"1. {text_content}")
        elif b_type == "codeBlock":
            md_lines.append(f"```\n{text_content}\n```")
        else:
            md_lines.append(text_content)
            
    return "\n\n".join(md_lines)


def markdown_to_blocks(md_content: str) -> str:
    if not md_content:
        return "[]"
    
    # Check if already JSON block array
    try:
        parsed = json.loads(md_content)
        if isinstance(parsed, list):
            return md_content
    except Exception:
        pass
        
    lines = md_content.split("\n")
    blocks = []
    
    in_code_block = False
    code_content = []
    first_h1_skipped = False
    
    for line in lines:
        stripped = line.strip()
        
        if stripped.startswith("```"):
            if in_code_block:
                in_code_block = False
                blocks.append({
                    "type": "codeBlock",
                    "content": "\n".join(code_content)
                })
                code_content = []
            else:
                in_code_block = True
            continue
            
        if in_code_block:
            code_content.append(line)
            continue
            
        if not stripped:
            continue
            
        if not first_h1_skipped:
            first_h1_skipped = True
            if stripped.startswith("# "):
                continue
            
        if stripped.startswith("# "):
            blocks.append({
                "type": "heading",
                "props": {"level": 1},
                "content": stripped[2:].strip()
            })
        elif stripped.startswith("## "):
            blocks.append({
                "type": "heading",
                "props": {"level": 2},
                "content": stripped[3:].strip()
            })
        elif stripped.startswith("### "):
            blocks.append({
                "type": "heading",
                "props": {"level": 3},
                "content": stripped[4:].strip()
            })
        elif stripped.startswith("- ") or stripped.startswith("* "):
            blocks.append({
                "type": "bulletListItem",
                "content": stripped[2:].strip()
            })
        elif re.match(r"^\d+\.\s+", stripped):
            match = re.match(r"^(\d+)\.\s+(.*)", stripped)
            blocks.append({
                "type": "numberedListItem",
                "content": match.group(2).strip()
            })
        else:
            blocks.append({
                "type": "paragraph",
                "content": line.strip()
            })
            
    return json.dumps(blocks)


class NoteService:
    def __init__(self, db: Session):
        self.db = db

    def _get_playlist_path(self, user: User, playlist_id: str) -> str:
        playlist = self.db.query(Playlist).filter(
            Playlist.id == playlist_id,
            Playlist.user_id == user.id
        ).first()
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
        
        return get_upload_path(user.username, playlist.name, custom_root=user.storage_root)

    def _get_note_dir(self, user: User, playlist_id: str | None) -> str:
        if playlist_id:
            playlist = self.db.query(Playlist).filter(
                Playlist.id == playlist_id,
                Playlist.user_id == user.id
            ).first()
            if not playlist:
                raise HTTPException(status_code=404, detail="Playlist not found")
            base_path = get_upload_path(user.username, playlist.name, custom_root=user.storage_root)
        else:
            base_path = get_upload_path(user.username, custom_root=user.storage_root)
            
        return os.path.join(base_path, "Notes")


    def create_note(self, playlist_id: str | None, title: str, content: str, user: User) -> Note:
        notes_dir = self._get_note_dir(user, playlist_id)
        os.makedirs(notes_dir, exist_ok=True) # Ensure notes directory exists

        sanitized_title = _sanitize_filename(title)
        base_filename = f"{sanitized_title}.md"
        final_filename = base_filename
        counter = 1
        
        # Ensure unique filename by appending a number if necessary
        while os.path.exists(os.path.join(notes_dir, final_filename)):
            final_filename = f"{sanitized_title}-{counter}.md"
            counter += 1
        
        file_path = os.path.join(notes_dir, final_filename)

        # Write markdown content to the file
        md_text = blocks_to_markdown(content)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(f"# {title}\n\n{md_text}")

        # Create a new Note entry in the database
        note = Note(
            id=str(uuid.uuid4()), # Keep UUID for internal DB ID
            title=title,
            content=content,
            note_type="markdown", # Assuming all new notes are markdown
            resource_id=None,
            chapter_id=None,
            subchapter_id=None,
            is_favorite=0,
            status="active" if playlist_id else "draft",
            created_at=datetime.datetime.utcnow(),
            updated_at=datetime.datetime.utcnow(),
            playlist_id=playlist_id, # Link note to its playlist (can be None)
            user_id=user.id,
            filename=final_filename # Store the actual filename used
        )

        self.db.add(note)
        self.db.commit()
        self.db.refresh(note)
        logger.info(f"Created new markdown note: {file_path} for playlist {playlist_id}")
        return note

    def refresh_notes(self, playlist_id: str | None, user: User):
        notes_dir = self._get_note_dir(user, playlist_id)

        sync_stats = {"added": 0, "updated": 0, "removed": 0}

        # Get all physical markdown files if directory exists
        physical_filenames = set()
        if os.path.exists(notes_dir):
            for file_name in os.listdir(notes_dir):
                if file_name.endswith(".md"):
                    physical_filenames.add(file_name)
        
        # Get all DB notes for this playlist/global that are NOT in a custom folder
        if playlist_id:
            db_notes_query = self.db.query(Note).filter(
                Note.playlist_id == playlist_id,
                Note.user_id == user.id,
                Note.folder_id.is_(None)
            )
        else:
            db_notes_query = self.db.query(Note).filter(
                Note.playlist_id.is_(None),
                Note.user_id == user.id,
                Note.folder_id.is_(None)
            )
        db_notes = db_notes_query.all()
        # Map DB notes by their stored filename for easy lookup
        db_notes_map_by_filename = {n.filename: n for n in db_notes if n.filename}
        # Also keep track of DB notes that are matched
        matched_db_note_ids = set()

        # Sync from physical files to DB
        for file_name in physical_filenames:
            file_path = os.path.join(notes_dir, file_name)
            if file_name in db_notes_map_by_filename:
                # Note exists in DB, check for updates
                db_note = db_notes_map_by_filename[file_name]
                matched_db_note_ids.add(db_note.id)
                
                with open(file_path, "r", encoding="utf-8") as f:
                    file_content = f.read()
                
                # Update title if different from first line (H1)
                first_line = file_content.split('\n', 1)[0]
                new_title = first_line.lstrip('# ').strip()
                if not new_title: # Fallback if no H1 title
                    new_title = file_name.replace(".md", "").replace("-", " ").title()

                blocks_content = markdown_to_blocks(file_content)

                if db_note.content != blocks_content or db_note.title != new_title:
                    db_note.content = blocks_content
                    db_note.title = new_title
                    db_note.updated_at = datetime.datetime.utcnow()
                    self.db.add(db_note)
                    sync_stats["updated"] += 1
                    logger.info(f"Updated note {db_note.id} (file: {file_name}) in DB from file")
            else:
                # New note, add to DB
                with open(file_path, "r", encoding="utf-8") as f:
                    file_content = f.read()
                
                first_line = file_content.split('\n', 1)[0]
                title = first_line.lstrip('# ').strip()
                if not title: # Fallback if no H1 title
                    title = file_name.replace(".md", "").replace("-", " ").title()

                blocks_content = markdown_to_blocks(file_content)

                note = Note(
                    id=str(uuid.uuid4()), # Generate new UUID for DB ID
                    title=title,
                    content=blocks_content,
                    note_type="markdown",
                    playlist_id=playlist_id,
                    user_id=user.id,
                    is_favorite=0,
                    status="active" if playlist_id else "draft",
                    created_at=datetime.datetime.utcnow(),
                    updated_at=datetime.datetime.utcnow(),
                    filename=file_name # Store the actual filename
                )
                self.db.add(note)
                sync_stats["added"] += 1
                logger.info(f"Added new note {note.id} (file: {file_name}) to DB from file")
        
        self.db.commit() # Commit all additions/updates

        # Clean up DB notes that no longer have a physical file
        for db_note in db_notes:
            if db_note.id not in matched_db_note_ids:
                # Also check if the physical file actually exists, as db_notes might not have a filename initially
                note_file_path = os.path.join(notes_dir, db_note.filename) if db_note.filename else None
                if not note_file_path or not os.path.exists(note_file_path):
                    self.db.delete(db_note)
                    sync_stats["removed"] += 1
                    logger.info(f"Removed note {db_note.id} from DB (physical file {db_note.filename} not found)")
        
        self.db.commit() # Commit all deletions
        return sync_stats

    def link_note_to_resource(self, note_id: str, resource_id: str = None, chapter_id: str = None, subchapter_id: str = None) -> Note:
        note = self.db.query(Note).filter(Note.id == note_id).first()
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")
        
        note.resource_id = resource_id
        note.chapter_id = chapter_id
        note.subchapter_id = subchapter_id
        note.updated_at = datetime.datetime.utcnow()

        self.db.add(note)
        self.db.commit()
        self.db.refresh(note)
        logger.info(f"Linked note {note_id} to resource: {resource_id}, chapter: {chapter_id}, subchapter: {subchapter_id}")
        return note

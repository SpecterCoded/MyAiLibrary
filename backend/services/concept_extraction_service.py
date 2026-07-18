import json
from typing import List, Dict
from services.llm_service import generate_structured_content
from models import Concept, SubChapter
from sqlalchemy.orm import Session
from uuid import uuid4

class ConceptExtractionEngine:
    @staticmethod
    def extract_concepts(subchapter_transcript: str, subchapter_id: str) -> List[Dict]:
        """
        Extracts concepts from a subchapter transcript using LLM.
        """
        prompt = f"""
        Extract key concepts from the following subchapter transcript.
        Rules:
        1. Extract 1-10 concepts depending on content size.
        2. Output JSON format:
        {{
            "concepts": [
                {{
                    "title": "...",
                    "description": "...",
                    "importance_score": 0.0-1.0
                }}
            ]
        }}
        
        Transcript: {subchapter_transcript}
        """
        result = generate_structured_content(prompt)
        concepts = result.get("concepts", [])
        
        # Add subchapter_id to concepts
        for concept in concepts:
            concept["subchapter_id"] = subchapter_id
            
        return concepts

def save_concepts(db: Session, concepts: List[Dict], chapter_id: str):
    for c_data in concepts:
        concept = Concept(
            id=str(uuid4()),
            title=c_data["title"],
            description=c_data["description"],
            importance_score=c_data["importance_score"],
            chapter_id=chapter_id,
            subchapter_id=c_data["subchapter_id"]
        )
        db.add(concept)
    db.commit()

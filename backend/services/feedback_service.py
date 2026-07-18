from uuid import uuid4
from sqlalchemy.orm import Session
from models import AnswerFeedback


def save_feedback(
    db: Session,
    user_id: str,
    resource_id: str,
    question: str,
    answer: str,
    rating: int,
    comment: str = None,
):
    feedback = AnswerFeedback(
        id=str(uuid4()),
        user_id=user_id,
        resource_id=resource_id,
        question=question,
        answer=answer,
        rating=rating,
        comment=comment,
    )
    db.add(feedback)
    db.commit()
    return feedback


def get_feedback_stats(db: Session, resource_id: str = None):
    query = db.query(AnswerFeedback)
    if resource_id:
        query = query.filter(AnswerFeedback.resource_id == resource_id)

    total = query.count()
    helpful = query.filter(AnswerFeedback.rating == 1).count()
    not_helpful = query.filter(AnswerFeedback.rating == -1).count()

    return {
        "total": total,
        "helpful": helpful,
        "not_helpful": not_helpful,
        "helpful_rate": round(helpful / total * 100, 1) if total > 0 else 0,
    }

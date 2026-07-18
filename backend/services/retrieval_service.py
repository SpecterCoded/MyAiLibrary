import os
from core.logger import get_logger

logger = get_logger("EMBEDDING")

MAX_DISTANCE = 1.5
DEBUG_RETRIEVAL = os.getenv("DEBUG_RETRIEVAL", "false").lower() in ("1", "true", "yes")

# Share the embedding_service Chroma client + per-workspace collections rather than
# opening a second client at a different path (the old path was wrong and pointed
# at an empty store).
from embedding_service import embed_text, get_collection

def search_resource(
    resource_id: str,
    query: str,
    user_id: str,
    n_results: int = 5,
    storage_root: str | None = None,
):

    query_embedding = embed_text(
        query,
        user_id=user_id,
        resource_id=resource_id,
        feature="resource_search_embedding",
    )

    results = get_collection(storage_root).query(
        query_embeddings=[query_embedding],
        n_results=n_results,
        where={"$and": [{"resource_id": resource_id}, {"user_id": user_id}]},
    )

    distances = results.get("distances", [[]])[0]
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]

    if DEBUG_RETRIEVAL:
        logger.debug("DISTANCES:")
        logger.debug(distances)
        logger.debug("METADATAS:")
        logger.debug(metadatas)

    filtered_documents: list[str] = []
    filtered_metadatas: list[dict] = []
    filtered_distances: list[float] = []

    for document, metadata, distance in zip(documents, metadatas, distances):
        if distance is None or distance > MAX_DISTANCE:
            continue
        filtered_documents.append(document)
        filtered_metadatas.append(metadata)
        filtered_distances.append(distance)

    return {
        "documents": filtered_documents,
        "metadatas": filtered_metadatas,
        "distances": filtered_distances,
    }

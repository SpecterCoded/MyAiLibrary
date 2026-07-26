import os
from core.paths import UPLOADS_DIR

UPLOADS_ROOT = os.getenv("UPLOADS_ROOT", str(UPLOADS_DIR))
ENABLE_PARENT_CHILD_RETRIEVAL = os.getenv(
    "ENABLE_PARENT_CHILD_RETRIEVAL",
    os.getenv("enable_parent_child_retrieval", "0"),
).lower() in ("1", "true", "yes")
ENABLE_HIERARCHICAL_RETRIEVAL = os.getenv(
    "ENABLE_HIERARCHICAL_RETRIEVAL",
    os.getenv("enable_hierarchical_retrieval", "0"),
).lower() in ("1", "true", "yes")
PARENT_CHILD_GROUP_SIZE = max(1, int(os.getenv("PARENT_CHILD_GROUP_SIZE", "3")))
PARENT_CHILD_MAX_CONTEXT_TOKENS = max(128, int(os.getenv("PARENT_CHILD_MAX_CONTEXT_TOKENS", "1800")))
PARENT_CHILD_MAX_SECTION_TOKENS = max(64, int(os.getenv("PARENT_CHILD_MAX_SECTION_TOKENS", "700")))
HIERARCHICAL_MAX_CONTEXT_TOKENS = max(128, int(os.getenv("HIERARCHICAL_MAX_CONTEXT_TOKENS", "2200")))
HIERARCHICAL_MAX_NODE_TOKENS = max(64, int(os.getenv("HIERARCHICAL_MAX_NODE_TOKENS", "500")))
ENABLE_EVALUATION = os.getenv(
    "ENABLE_EVALUATION",
    os.getenv("enable_evaluation", "1"),
).lower() in ("1", "true", "yes")
ENABLE_COST_TRACKING = os.getenv(
    "ENABLE_COST_TRACKING",
    os.getenv("enable_cost_tracking", "1"),
).lower() in ("1", "true", "yes")
ENABLE_QUALITY_METRICS = os.getenv(
    "ENABLE_QUALITY_METRICS",
    os.getenv("enable_quality_metrics", "1"),
).lower() in ("1", "true", "yes")
ENABLE_REGRESSION_REPORTS = os.getenv(
    "ENABLE_REGRESSION_REPORTS",
    os.getenv("enable_regression_reports", "1"),
).lower() in ("1", "true", "yes")
ENABLE_HTML_REPORTS = os.getenv(
    "ENABLE_HTML_REPORTS",
    os.getenv("enable_html_reports", "1"),
).lower() in ("1", "true", "yes")
enable_parent_child_retrieval = ENABLE_PARENT_CHILD_RETRIEVAL
enable_hierarchical_retrieval = ENABLE_HIERARCHICAL_RETRIEVAL
enable_evaluation = ENABLE_EVALUATION
enable_cost_tracking = ENABLE_COST_TRACKING
enable_quality_metrics = ENABLE_QUALITY_METRICS
enable_regression_reports = ENABLE_REGRESSION_REPORTS
enable_html_reports = ENABLE_HTML_REPORTS

ENABLE_CHUNK_OVERLAP = os.getenv(
    "ENABLE_CHUNK_OVERLAP",
    os.getenv("enable_chunk_overlap", "0"),
).lower() in ("1", "true", "yes")
CHUNK_OVERLAP_CHARS = max(50, int(os.getenv("CHUNK_OVERLAP_CHARS", "150")))
enable_chunk_overlap = ENABLE_CHUNK_OVERLAP

ENABLE_QUERY_ROUTING = os.getenv(
    "ENABLE_QUERY_ROUTING",
    os.getenv("enable_query_routing", "0"),
).lower() in ("1", "true", "yes")
enable_query_routing = ENABLE_QUERY_ROUTING

ENABLE_HYDE = os.getenv(
    "ENABLE_HYDE",
    os.getenv("enable_hyde", "0"),
).lower() in ("1", "true", "yes")
enable_hyde = ENABLE_HYDE

ENABLE_DOCUMENT_SEMANTIC_CHUNKING = os.getenv(
    "ENABLE_DOCUMENT_SEMANTIC_CHUNKING",
    os.getenv("enable_document_semantic_chunking", "0"),
).lower() in ("1", "true", "yes")
enable_document_semantic_chunking = ENABLE_DOCUMENT_SEMANTIC_CHUNKING

EMBEDDING_COMPRESSION = os.getenv(
    "EMBEDDING_COMPRESSION",
    os.getenv("embedding_compression", "0"),
).lower() in ("1", "true", "yes")
embedding_compression = EMBEDDING_COMPRESSION

CACHE_TTL_HOURS = max(1, int(os.getenv("CACHE_TTL_HOURS", "24")))
CACHE_MAX_ENTRIES = max(10, int(os.getenv("CACHE_MAX_ENTRIES", "1000")))

def get_upload_path(user_name: str, playlist_name: str = None, folder_name: str = None, custom_root: str = None):
    """
    Returns the hierarchical path for uploads using names.
    Structure: {custom_root or UPLOADS_ROOT}/{user_name}/{playlist_name}/{folder_name}
    """
    root = custom_root or UPLOADS_ROOT
    path = os.path.join(root, user_name)
    if playlist_name:
        path = os.path.join(path, playlist_name)
        if folder_name:
            path = os.path.join(path, folder_name)
    return path

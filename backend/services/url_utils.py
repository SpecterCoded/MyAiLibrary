API_PATH_SUFFIXES = ["/chat/completions", "/embeddings"]


def strip_api_suffix(url: str) -> str:
    url = url.strip().rstrip("/")
    for suffix in API_PATH_SUFFIXES:
        if url.endswith(suffix):
            return url[: -len(suffix)]
    return url

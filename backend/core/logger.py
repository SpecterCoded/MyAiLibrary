import logging
import os
import warnings
from rich.logging import RichHandler
from rich.console import Console

# Configure console
console = Console()

# Define categories and their colors
CATEGORY_COLORS = {
    "AUTH": "magenta",
    "RESOURCE": "blue",
    "UPLOAD": "blue",
    "PROCESSING": "yellow",
    "EMBEDDING": "cyan",
    "RAG": "cyan",
    "CHAT": "blue",
    "SEARCH": "green",
    "CACHE": "green",
    "SUMMARY": "yellow",
    "FLASHCARDS": "yellow",
    "QUIZ": "yellow",
    "MINDMAP": "yellow",
    "DATABASE": "yellow",
    "SYSTEM": "white",
    "ERROR": "red",
}

# Define noisy libraries to suppress
NOISY_LIBS = [
    "transformers",
    "sentence_transformers",
    "tokenizers",
    "httpx",
    "urllib3",
    "chromadb",
    "onnxruntime",
    "huggingface_hub",
    "uvicorn.access",
    "openrouter",
    "watchfiles",
    "watchfiles.main"
]

# Define a filter to ensure 'category' always exists in the LogRecord
class CategoryFilter(logging.Filter):
    def filter(self, record):
        if not hasattr(record, "category"):
            record.category = "SYSTEM"
        return True

def setup_logger():
    # Suppress specific deprecation warnings
    warnings.filterwarnings("ignore", category=DeprecationWarning, message=".*asyncio.iscoroutinefunction.*")
    warnings.filterwarnings("ignore", category=DeprecationWarning, message=".*on_event is deprecated.*")

    # Set global log level to WARNING to reduce noise
    log_level = logging.WARNING
    
    # Configure RichHandler
    rich_handler = RichHandler(
        console=console,
        show_time=True,
        show_path=False,
        show_level=True,
        rich_tracebacks=os.getenv("DEBUG", "false").lower() == "true",
    )
    rich_handler.addFilter(CategoryFilter())
    
    logging.basicConfig(
        level=log_level,
        format="[%(asctime)s] [%(category)s] [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        handlers=[rich_handler]
    )
    
    # Explicitly set SYSTEM to INFO so we still see those logs
    logging.getLogger("SYSTEM").setLevel(logging.INFO)
    
    # Suppress noise
    for lib in NOISY_LIBS:
        logging.getLogger(lib).setLevel(logging.WARNING)

    return logging.getLogger("MyAILibrary")

# Create a wrapper function to add category support
def get_logger(category: str):
    logger = logging.getLogger(category)
    
    # Custom adapter to inject category
    class CategoryAdapter(logging.LoggerAdapter):
        def process(self, msg, kwargs):
            kwargs["extra"] = {"category": self.extra["category"]}
            return msg, kwargs
            
    return CategoryAdapter(logger, {"category": category})

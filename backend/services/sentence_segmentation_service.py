import contextlib
import os
from pathlib import Path

from core.logger import get_logger
from .dependency_failure_service import local_path_failure

logger = get_logger("SYSTEM")

_wtp_model = None
_wtp_model_key: str | None = None
_wtp_model_failed_key: str | None = None
_configured_wtp_model_path: str | None = os.getenv("WTP_MODEL_PATH") or None
_WTP_SERVICE = "WTP Canine"
_WTP_STAGE = "chunking"
_WTP_SECTION = "WTP Canine Sentence Model"
_WTP_PATH_LABEL = "WTP Canine model folder"
WTP_TOKENIZER_DIR_NAME = "tokenizer"


def _is_tokenizer_dir(path: Path) -> bool:
    return path.is_dir() and (
        (path / "tokenizer.json").is_file()
        or (path / "sentencepiece.bpe.model").is_file()
        or (path / "tokenizer.model").is_file()
    )


def resolve_wtp_tokenizer_path(model_path: str | Path) -> Path | None:
    """Return the local tokenizer folder paired with a downloaded SaT model."""
    path = Path(model_path).expanduser()
    candidates = [
        path,
        path / WTP_TOKENIZER_DIR_NAME,
        path / "tokenizer-xlm-roberta-base",
        path.parent / WTP_TOKENIZER_DIR_NAME,
        path.parent / "tokenizer-xlm-roberta-base",
        path.parent / "xlm-roberta-base",
    ]
    env_path = os.getenv("WTP_TOKENIZER_PATH")
    if env_path:
        candidates.insert(0, Path(env_path).expanduser())
    for candidate in candidates:
        if _is_tokenizer_dir(candidate):
            return candidate
    return None


def load_wtp_sat_model(model_path: str | Path):
    """Load a local SaT model with its local tokenizer.

    wtpsplit's default tokenizer is the remote `facebookAI/xlm-roberta-base`.
    Passing a local tokenizer path prevents Electron/offline runs from trying to
    contact Hugging Face during Ask AI chunking.
    """
    from wtpsplit import SaT

    path = Path(model_path).expanduser()
    tokenizer_path = resolve_wtp_tokenizer_path(path)
    if tokenizer_path is None:
        raise local_path_failure(
            code="tokenizer_missing",
            service=_WTP_SERVICE,
            stage=_WTP_STAGE,
            settings_section=_WTP_SECTION,
            path_label=_WTP_PATH_LABEL,
        )

    return SaT(
        str(path),
        tokenizer_name_or_path=str(tokenizer_path),
        from_pretrained_kwargs={"local_files_only": True},
        ort_providers=["CPUExecutionProvider"],
    )


def configure_wtp_model_path(model_path: str | None) -> None:
    """Set the process-level WTP/SaT model path used by sentence splitting.

    The splitter is intentionally lazy. Updating the path clears the cached model
    so the next split attempt loads the newly configured local model.
    """
    global _configured_wtp_model_path, _wtp_model, _wtp_model_key, _wtp_model_failed_key
    next_path = (model_path or "").strip() or None
    if next_path == _configured_wtp_model_path:
        return
    _configured_wtp_model_path = next_path
    _wtp_model = None
    _wtp_model_key = None
    _wtp_model_failed_key = None


def _model_key() -> str | None:
    if not _configured_wtp_model_path:
        return None
    return str(Path(_configured_wtp_model_path).expanduser())


def _get_wtp_model():
    global _wtp_model, _wtp_model_key, _wtp_model_failed_key
    key = _model_key()
    if not key:
        raise local_path_failure(
            code="path_missing",
            service=_WTP_SERVICE,
            stage=_WTP_STAGE,
            settings_section=_WTP_SECTION,
            path_label=_WTP_PATH_LABEL,
        )
    if _wtp_model is not None and _wtp_model_key == key:
        return _wtp_model

    path = Path(key)
    if not path.exists():
        _wtp_model_failed_key = key
        raise local_path_failure(
            code="path_not_found",
            service=_WTP_SERVICE,
            stage=_WTP_STAGE,
            settings_section=_WTP_SECTION,
            path_label=_WTP_PATH_LABEL,
        )

    try:
        logger.info(f"Loading configured WTP Canine model: {key}")
        with open(os.devnull, "w") as devnull:
            with contextlib.redirect_stderr(devnull), contextlib.redirect_stdout(devnull):
                _wtp_model = load_wtp_sat_model(key)
        _wtp_model_key = key
        _wtp_model_failed_key = None
        return _wtp_model
    except Exception as exc:
        logger.warning(f"Could not load configured WTP Canine model ({exc}).")
        _wtp_model = None
        _wtp_model_key = None
        _wtp_model_failed_key = key
        raise local_path_failure(
            code="path_not_loadable",
            service=_WTP_SERVICE,
            stage=_WTP_STAGE,
            settings_section=_WTP_SECTION,
            path_label=_WTP_PATH_LABEL,
        ) from exc


def split_into_sentences(text: str):
    if not text:
        return []

    model = _get_wtp_model()
    try:
        sentences = model.split(text)
    except Exception as exc:
        logger.warning(f"WTP Canine sentence split failed ({exc}).")
        raise local_path_failure(
            code="path_not_loadable",
            service=_WTP_SERVICE,
            stage=_WTP_STAGE,
            settings_section=_WTP_SECTION,
            path_label=_WTP_PATH_LABEL,
        ) from exc

    return [sentence.strip() for sentence in sentences if sentence and sentence.strip()]

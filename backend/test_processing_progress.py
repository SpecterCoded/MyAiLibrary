import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import ProcessingJob
from services.processing_progress import (
    progress_mode_for,
    unit_progress,
    update_processing_progress,
)


class ProcessingProgressTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.job = ProcessingJob(
            id="job-1",
            resource_id="resource-1",
            status="processing",
            job_type="full",
            progress=0,
        )
        self.db.add(self.job)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_progress_is_clamped_and_never_moves_backward(self):
        update_processing_progress(self.db, self.job.id, "subchaptering", progress=70)
        update_processing_progress(self.db, self.job.id, "chaptering", progress=40)
        self.db.refresh(self.job)
        self.assertEqual(self.job.progress, 70)
        self.assertEqual(self.job.current_stage, "chaptering")
        update_processing_progress(self.db, self.job.id, "embedding", progress=140)
        self.db.refresh(self.job)
        self.assertEqual(self.job.progress, 100)

    def test_verified_checkpoint_modes(self):
        update_processing_progress(self.db, self.job.id, "transcribing")
        self.db.refresh(self.job)
        self.assertEqual(self.job.progress, 8)
        self.assertEqual(progress_mode_for(self.job), "indeterminate")
        update_processing_progress(self.db, self.job.id, "embedding", progress=88)
        self.db.refresh(self.job)
        self.assertEqual(progress_mode_for(self.job), "determinate")
        self.job.status = "failed"
        self.db.commit()
        self.assertEqual(progress_mode_for(self.job), "terminal")
        self.assertEqual(self.job.progress, 88)

    def test_per_unit_progress_uses_verified_range(self):
        self.assertEqual(unit_progress(55, 75, 0, 4), 55)
        self.assertEqual(unit_progress(55, 75, 2, 4), 65)
        self.assertEqual(unit_progress(55, 75, 4, 4), 75)


if __name__ == "__main__":
    unittest.main()

"""Download the public Kaggle archive without credentials, then derive the exact slice."""

import argparse
import hashlib
import urllib.request
from pathlib import Path

from prepare_dataset import prepare

URL = (
    "https://www.kaggle.com/api/v1/datasets/download/konradb/atticus-open-contract-dataset-aok-beta"
)
EXPECTED = "ec5b9751cb1b246eda584272d5420ab79c4ec70c018bda90aac905a9d1504de4"

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(".runtime/cuad-kaggle.zip"))
    path = parser.parse_args().output
    path.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(URL, path)
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != EXPECTED:
        raise SystemExit(
            "Kaggle archive has changed. Review the new version before regenerating labels."
        )
    prepare(path)

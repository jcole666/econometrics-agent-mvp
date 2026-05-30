from __future__ import annotations

import io

import pandas as pd
from fastapi import FastAPI, File, UploadFile

from app.schemas import ModelRecommendation, ModelRequest
from app.services.code_generator import generate_code
from app.services.data_profile import profile_dataframe
from app.services.model_selector import select_model

app = FastAPI(title="Econometrics Agent MVP")


@app.get("/")
def health_check() -> dict:
    return {"status": "ok", "message": "Econometrics Agent MVP is running"}


@app.post("/profile-data")
async def profile_data(file: UploadFile = File(...)) -> dict:
    content = await file.read()
    suffix = (file.filename or "").lower()

    if suffix.endswith(".xlsx") or suffix.endswith(".xls"):
        df = pd.read_excel(io.BytesIO(content))
    else:
        df = pd.read_csv(io.BytesIO(content))

    return profile_dataframe(df)


@app.post("/recommend-model", response_model=ModelRecommendation)
def recommend_model(request: ModelRequest) -> ModelRecommendation:
    model, reason, checks = select_model(request)
    code = generate_code(model, request)
    return ModelRecommendation(
        model=model,
        reason=reason,
        required_checks=checks,
        generated_code=code,
    )


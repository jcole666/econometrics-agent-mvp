from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from sidecar.schemas import (
    ChatRequest,
    ChatResponse,
    InferVariablesRequest,
    InferVariablesResponse,
    ModelRecommendation,
    ModelRequest,
    ReportRequest,
    ReportResponse,
    RunModelResponse,
)
from sidecar.services.chat_service import chat_with_agent
from sidecar.services.code_generator import generate_code
from sidecar.services.data_io import read_upload_dataframe
from sidecar.services.data_profile import profile_dataframe
from sidecar.services.maas_client import MaasUnavailable, get_maas_recommendation, get_maas_status, llm_provider_name
from sidecar.services.model_runner import run_model
from sidecar.services.model_selector import select_model
from sidecar.services.report_generator import generate_markdown_report
from sidecar.services.variable_inferrer import infer_variables

def app_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parents[1]


PROJECT_ROOT = app_root()
SAMPLE_DATA_PATH = PROJECT_ROOT / "examples" / "sample_city_panel.csv"

app = FastAPI(
    title="计量建模 Agent 工作台后端",
    description="本地 API：数据画像、变量识别、模型推荐、模型运行、问答和报告生成。",
    version="0.1.0",
    docs_url="/api-docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok", "maas": get_maas_status()}


@app.post("/profile-data")
async def profile_data(file: UploadFile = File(...)) -> dict:
    try:
        df = await read_upload_dataframe(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return profile_dataframe(df)


@app.get("/sample-profile")
def sample_profile() -> dict:
    df = pd.read_csv(SAMPLE_DATA_PATH)
    return profile_dataframe(df)


@app.get("/sample-data")
def sample_data() -> FileResponse:
    return FileResponse(SAMPLE_DATA_PATH, media_type="text/csv", filename="sample_city_panel.csv")


@app.post("/infer-variables", response_model=InferVariablesResponse)
def infer_variables_endpoint(request: InferVariablesRequest) -> InferVariablesResponse:
    return infer_variables(request)


@app.post("/recommend-model", response_model=ModelRecommendation)
def recommend_model(request: ModelRequest) -> ModelRecommendation:
    model, reason, checks = select_model(request)
    code = generate_code(model, request)

    try:
        maas_result = get_maas_recommendation(request, model, reason, checks, code)
        return ModelRecommendation(
            model=maas_result.model,
            reason=maas_result.reason,
            required_checks=maas_result.required_checks,
            generated_code=maas_result.generated_code,
            provider=llm_provider_name(request.llm_config),
            maas_used=True,
            maas_note=maas_result.note,
        )
    except MaasUnavailable as exc:
        return ModelRecommendation(
            model=model,
            reason=reason,
            required_checks=checks,
            generated_code=code,
            provider="rules",
            maas_used=False,
            maas_error=str(exc),
        )


@app.post("/run-model", response_model=RunModelResponse)
async def run_model_endpoint(
    file: UploadFile = File(...),
    model_type: str = Form(...),
    dependent_variable: str = Form(...),
    independent_variables: str = Form(...),
    entity_column: str | None = Form(None),
    time_column: str | None = Form(None),
    treatment_column: str | None = Form(None),
    running_variable: str | None = Form(None),
    instrument_variable: str | None = Form(None),
) -> RunModelResponse:
    _ = (treatment_column, running_variable, instrument_variable)
    try:
        df = await read_upload_dataframe(file)
    except ValueError as exc:
        return RunModelResponse(model_type=model_type, success=False, error=str(exc))

    xs = [item.strip() for item in independent_variables.split(",") if item.strip()]
    return run_model(
        df=df,
        model_type=model_type,
        dependent_variable=dependent_variable,
        independent_variables=xs,
        entity_column=entity_column,
        time_column=time_column,
    )


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    return chat_with_agent(request)


@app.post("/generate-report", response_model=ReportResponse)
def generate_report(request: ReportRequest) -> ReportResponse:
    return generate_markdown_report(request)

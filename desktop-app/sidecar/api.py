from __future__ import annotations

import os
from pathlib import Path
import sys

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

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
    ScatterResponse,
    CorrHeatmapResponse,
    ExplainModelRequest,
    ModelExplanation,
    ModelRunCompareRequest,
    ModelRunCompareResponse,
    ModelRunCreateRequest,
    ModelRunListResponse,
    ModelRunRecord,
    VariableDictConfirmRequest,
    VariableDictConfirmResponse,
    VariableDictInferRequest,
    VariableDictInferResponse,
    VariableDictPatchPreviewRequest,
    VariableDictPatchPreviewResponse,
    VariableDictionary,
)
from sidecar.services.chat_service import chat_with_agent
from sidecar.services.code_generator import generate_code
from sidecar.services.data_io import read_upload_dataframe
from sidecar.services.data_profile import profile_dataframe
from sidecar.services.maas_client import MaasUnavailable, get_maas_recommendation, get_maas_status, llm_provider_name
from sidecar.services.model_explainer import explain_model
from sidecar.services.model_runner import run_model
from sidecar.services.model_runs import (
    attach_explanation,
    compare_runs,
    create_run,
    get_run,
    list_runs,
)
from sidecar.services.model_selector import select_model
from sidecar.services.relationship_stats import corr_heatmap, scatter_stats
from sidecar.services.report_generator import generate_markdown_report
from sidecar.services.variable_dictionary import (
    confirm_patches,
    get_dictionary,
    infer_dictionary,
    preview_patch,
)
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

# 打包版通过 file:// 加载页面，浏览器发送的 Origin 是字符串 "null"；
# 开发版走 Vite（5173）。两套来源都要放行，否则发布版所有请求都会被 CORS 拦掉。
# 本服务不依赖 Cookie，因此关闭 allow_credentials，并只放行实际用到的方法与请求头。
ALLOWED_ORIGINS = ["null", "http://127.0.0.1:5173", "http://localhost:5173"]
ALLOWED_METHODS = ["GET", "POST", "OPTIONS"]
ALLOWED_HEADERS = ["Content-Type", "X-Xiaoji-Token"]

# 本机令牌：Electron 启动 sidecar 时写入环境变量，前端通过 preload 取值后带在请求头里。
# 未设置环境变量时整段跳过（源码调试、pytest 都不受影响）。
# 顺序很重要：本中间件先注册，CORS 后注册 → CORS 在外层，预检与 401 响应都能正常带上
# CORS 头；同时这里仍显式放行 OPTIONS，避免将来调整顺序时又把预检打成 401。
LOCAL_TOKEN_ENV = "XIAOJI_LOCAL_TOKEN"
LOCAL_TOKEN_HEADER = "x-xiaoji-token"
PUBLIC_PATHS = {"/health"}


@app.middleware("http")
async def require_local_token(request: Request, call_next):
    expected = os.getenv(LOCAL_TOKEN_ENV, "").strip()
    if not expected or request.method == "OPTIONS" or request.url.path in PUBLIC_PATHS:
        return await call_next(request)
    if request.headers.get(LOCAL_TOKEN_HEADER) == expected:
        return await call_next(request)
    return JSONResponse(
        status_code=401,
        content={"detail": "缺少或错误的本机访问令牌，请通过桌面应用调用本地服务。"},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=ALLOWED_METHODS,
    allow_headers=ALLOWED_HEADERS,
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
    df = pd.read_csv(SAMPLE_DATA_PATH, encoding="utf-8-sig")
    return profile_dataframe(df)


@app.get("/sample-data")
def sample_data() -> FileResponse:
    return FileResponse(SAMPLE_DATA_PATH, media_type="text/csv", filename="sample_city_panel.csv")


@app.post("/infer-variables", response_model=InferVariablesResponse)
def infer_variables_endpoint(request: InferVariablesRequest) -> InferVariablesResponse:
    return infer_variables(request)


@app.post("/variable-dict/infer", response_model=VariableDictInferResponse)
def variable_dict_infer(request: VariableDictInferRequest) -> VariableDictInferResponse:
    return infer_dictionary(request)


@app.post("/variable-dict/patch-preview", response_model=VariableDictPatchPreviewResponse)
def variable_dict_patch_preview(request: VariableDictPatchPreviewRequest) -> VariableDictPatchPreviewResponse:
    return preview_patch(request)


@app.post("/variable-dict/confirm", response_model=VariableDictConfirmResponse)
def variable_dict_confirm(request: VariableDictConfirmRequest) -> VariableDictConfirmResponse:
    try:
        dictionary = confirm_patches(
            dataset_id=request.dataset_id,
            dataset_hash=request.dataset_hash,
            patches=request.patches,
            dictionary=request.dictionary,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return VariableDictConfirmResponse(dictionary=dictionary)


@app.get("/variable-dict", response_model=VariableDictionary)
def variable_dict_get(dataset_id: str, dataset_hash: str | None = None) -> VariableDictionary:
    try:
        dictionary = get_dictionary(dataset_id, dataset_hash)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if dictionary is None:
        raise HTTPException(status_code=404, detail="尚未为当前数据集保存变量字典。")
    return dictionary


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
    policy_period: float | None = Form(None),
    cutoff: float | None = Form(None),
    bandwidth: float | None = Form(None),
) -> RunModelResponse:
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
        treatment_column=treatment_column,
        running_variable=running_variable,
        instrument_variable=instrument_variable,
        policy_period=policy_period,
        cutoff=cutoff,
        bandwidth=bandwidth,
    )


@app.post("/relationship/scatter", response_model=ScatterResponse)
async def relationship_scatter(
    file: UploadFile = File(...),
    x_column: str = Form(...),
    y_column: str = Form(...),
) -> ScatterResponse:
    try:
        df = await read_upload_dataframe(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        return scatter_stats(df, x_column, y_column)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/relationship/corr-heatmap", response_model=CorrHeatmapResponse)
async def relationship_corr_heatmap(
    file: UploadFile = File(...),
    columns: str = Form(...),
) -> CorrHeatmapResponse:
    try:
        df = await read_upload_dataframe(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    selected = [item.strip() for item in columns.split(",") if item.strip()]
    try:
        return corr_heatmap(df, selected)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/explain/model", response_model=ModelExplanation)
def explain_model_endpoint(request: ExplainModelRequest) -> ModelExplanation:
    return explain_model(request)


@app.post("/model-runs", response_model=ModelRunRecord)
def create_model_run_endpoint(request: ModelRunCreateRequest) -> ModelRunRecord:
    try:
        return create_run(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/model-runs", response_model=ModelRunListResponse)
def list_model_runs_endpoint(dataset_id: str) -> ModelRunListResponse:
    try:
        return ModelRunListResponse(runs=list_runs(dataset_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/model-runs/compare", response_model=ModelRunCompareResponse)
def compare_model_runs_endpoint(request: ModelRunCompareRequest) -> ModelRunCompareResponse:
    try:
        return compare_runs(request.dataset_id, request.left_id, request.right_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/model-runs/{version_id}", response_model=ModelRunRecord)
def get_model_run_endpoint(version_id: str, dataset_id: str) -> ModelRunRecord:
    try:
        record = get_run(dataset_id, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=404, detail=f"版本 {version_id} 不存在。")
    return record


@app.post("/model-runs/{version_id}/explanation", response_model=ModelRunRecord)
def attach_model_explanation_endpoint(
    version_id: str,
    dataset_id: str,
    explanation: ModelExplanation,
) -> ModelRunRecord:
    try:
        record = attach_explanation(dataset_id, version_id, explanation)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=404, detail=f"版本 {version_id} 不存在。")
    return record


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    return chat_with_agent(request)


@app.post("/generate-report", response_model=ReportResponse)
def generate_report(request: ReportRequest) -> ReportResponse:
    return generate_markdown_report(request)

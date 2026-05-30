from pydantic import BaseModel


class ModelRequest(BaseModel):
    research_question: str
    columns: list[str]
    dependent_variable: str | None = None
    independent_variables: list[str] = []
    entity_column: str | None = None
    time_column: str | None = None
    treatment_column: str | None = None
    running_variable: str | None = None
    instrument_variable: str | None = None


class ModelRecommendation(BaseModel):
    model: str
    reason: str
    required_checks: list[str]
    generated_code: str


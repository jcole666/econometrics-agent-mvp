// 将 pandas dtype 原始字符串映射为中文显示名
export function dtypeLabel(dtype: string): string {
  const map: Record<string, string> = {
    "int64": "整数",
    "int32": "整数",
    "int16": "整数",
    "int8": "整数",
    "int": "整数",
    "float64": "浮点数",
    "float32": "浮点数",
    "float": "浮点数",
    "object": "文本",
    "str": "文本",
    "bool": "布尔",
    "datetime64[ns]": "日期",
    "datetime64": "日期",
  };
  return map[dtype] ?? dtype;
}

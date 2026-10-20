import type { LogLevel } from "../types/logs";

export interface ParsedLogPayload {
  isJson: boolean;
  level: LogLevel;
  message: string;
  timestamp: string;
  attributes: Record<string, unknown>;
  rawJson: Record<string, unknown> | null;
  rawText: string;
}

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\u001b\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(text: string): string {
  if (!text) return "";
  return text.replace(ANSI_REGEX, "");
}

export function parseLogPayload(
  rawMessage: string,
  fallbackLevel: LogLevel = "INFO"
): ParsedLogPayload {
  const cleanText = stripAnsi(rawMessage).trim();

  if (!cleanText) {
    return {
      isJson: false,
      level: fallbackLevel,
      message: "",
      timestamp: new Date().toISOString(),
      attributes: {},
      rawJson: null,
      rawText: rawMessage,
    };
  }

  if (
    (cleanText.startsWith("{") && cleanText.endsWith("}")) ||
    (cleanText.startsWith("[") && cleanText.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(cleanText);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const json = parsed as Record<string, unknown>;

        const rawLevel = String(
          json.level || json.severity || json.lvl || json.level_name || fallbackLevel
        ).toUpperCase();
        let level: LogLevel = "INFO";
        if (
          rawLevel.includes("ERR") ||
          rawLevel.includes("FAIL") ||
          rawLevel.includes("FATAL")
        ) {
          level = "ERROR";
        } else if (rawLevel.includes("WARN")) {
          level = "WARN";
        } else if (rawLevel.includes("DEBUG") || rawLevel.includes("TRACE")) {
          level = "DEBUG";
        }

        const tsVal =
          json.timestamp || json.time || json["@timestamp"] || json.asctime || json.ts;
        const timestamp = tsVal ? String(tsVal) : new Date().toISOString();

        const message = String(
          json.message ||
            json.msg ||
            json.event ||
            json.error ||
            json.reason ||
            json.action ||
            JSON.stringify(json)
        );

        const attributes: Record<string, unknown> = {};
        const reservedKeys = new Set([
          "level",
          "severity",
          "lvl",
          "level_name",
          "timestamp",
          "time",
          "@timestamp",
          "asctime",
          "ts",
          "message",
          "msg",
          "event",
          "error",
          "reason",
        ]);

        for (const [k, v] of Object.entries(json)) {
          if (!reservedKeys.has(k) && v !== undefined && v !== null) {
            attributes[k] = v;
          }
        }

        return {
          isJson: true,
          level,
          message,
          timestamp,
          attributes,
          rawJson: json,
          rawText: cleanText,
        };
      }
    } catch {
      // Text fallback
    }
  }

  let level: LogLevel = fallbackLevel;
  const upper = cleanText.toUpperCase();
  if (upper.includes("ERROR") || upper.includes("FAIL") || upper.includes("FATAL")) {
    level = "ERROR";
  } else if (upper.includes("WARN")) {
    level = "WARN";
  } else if (upper.includes("DEBUG") || upper.includes("TRACE")) {
    level = "DEBUG";
  }

  return {
    isJson: false,
    level,
    message: cleanText,
    timestamp: new Date().toISOString(),
    attributes: {},
    rawJson: null,
    rawText: cleanText,
  };
}

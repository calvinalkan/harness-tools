import type { ToolResultEvent } from "@mariozechner/pi-coding-agent";

import { incrementMap, type PromptRollup, type TurnRollup } from "./rollups";
import type { Span } from "./types";
import {
	extractCommand,
	getNumber,
	getString,
	isRecord,
	MAX_COMMAND_LENGTH,
	MAX_OUTPUT_LENGTH,
	truncate,
} from "./utils";

function processToolResult(
	event: ToolResultEvent,
	rollup: PromptRollup,
	turnRollup: TurnRollup | null,
): void {
	const toolName = event.toolName;
	const input = event.input;

	if (toolName === "read" || toolName === "edit" || toolName === "write") {
		const filePath = getString(input, "path");
		if (filePath !== undefined && filePath !== "") {
			incrementMap(rollup.fileOperations, filePath);
			if (turnRollup !== null) {
				incrementMap(turnRollup.fileOperations, filePath);
			}

			let toolFiles = rollup.filesByTool.get(toolName);
			if (toolFiles === undefined) {
				toolFiles = new Map();
				rollup.filesByTool.set(toolName, toolFiles);
			}
			incrementMap(toolFiles, filePath);
		}
	}

	if (toolName === "bash") {
		const command = getString(input, "command");
		if (command !== undefined && command !== "") {
			const parsed = extractCommand(command);
			incrementMap(rollup.bashCommands, parsed);
			if (turnRollup !== null) {
				incrementMap(turnRollup.bashCommands, parsed);
			}
		}
	}

	const details = event.details;
	if (isRecord(details)) {
		const truncation = details["truncation"];
		if (isRecord(truncation) && truncation["truncated"] === true) {
			rollup.toolTruncationCount++;
		}
	}

	if (toolName === "read" || toolName === "write") {
		const content = event.content;
		if (content.length > 0) {
			const textContent = content.find((c) => c.type === "text");
			if (textContent !== undefined && "text" in textContent) {
				const text = textContent.text;
				if (typeof text === "string") {
					incrementMap(rollup.toolBytes, toolName, text.length);
				}
			}
		}
	}
}

function addToolSpanAttributes(span: Span, event: ToolResultEvent): void {
	const toolName = event.toolName;
	const input = event.input;
	const content = event.content;
	const details = event.details;

	const inputJson = JSON.stringify(input);
	span.attributes["tool.input_length"] = inputJson.length;

	const textContent = content.find((c) => c.type === "text");
	const textValue =
		textContent !== undefined && "text" in textContent ? textContent.text : undefined;
	const outputText = typeof textValue === "string" ? textValue : undefined;

	if (event.isError && outputText !== undefined) {
		const { text: truncatedText } = truncate(outputText, MAX_OUTPUT_LENGTH);
		span.attributes["error.message"] = truncatedText;
	}

	if (toolName === "bash") {
		const command = getString(input, "command");
		if (command !== undefined && command !== "") {
			const { text, length } = truncate(command, MAX_COMMAND_LENGTH);
			span.attributes["tool.command"] = text;
			span.attributes["tool.command_length"] = length;
			span.attributes["tool.command_parsed"] = extractCommand(command);
		}
		const timeout = getNumber(input, "timeout");
		if (timeout !== undefined) {
			span.attributes["tool.timeout"] = timeout;
		}
		if (isRecord(details)) {
			const truncation = details["truncation"];
			if (isRecord(truncation)) {
				span.attributes["tool.truncated"] = truncation["truncated"] === true;
			}
			const fullOutputPath = getString(details, "fullOutputPath");
			if (fullOutputPath !== undefined && fullOutputPath !== "") {
				span.attributes["tool.full_output_path"] = fullOutputPath;
			}
		}
		if (outputText !== undefined) {
			const { text: truncatedText, length } = truncate(outputText, MAX_OUTPUT_LENGTH);
			span.attributes["tool.output"] = truncatedText;
			span.attributes["tool.output_length"] = length;
		}
	} else if (toolName === "read") {
		const path = getString(input, "path");
		if (path !== undefined) {
			span.attributes["tool.path"] = path;
		}
		const offset = getNumber(input, "offset");
		if (offset !== undefined) {
			span.attributes["tool.offset"] = offset;
		}
		const limit = getNumber(input, "limit");
		if (limit !== undefined) {
			span.attributes["tool.limit"] = limit;
		}
		if (isRecord(details)) {
			const truncation = details["truncation"];
			if (isRecord(truncation)) {
				span.attributes["tool.truncated"] = truncation["truncated"] === true;
			}
		}
		if (content.length > 0) {
			const imageContent = content.find((c) => c.type === "image");
			span.attributes["tool.is_image"] = imageContent !== undefined;
			if (outputText !== undefined) {
				const { text: truncatedText, length } = truncate(outputText, MAX_OUTPUT_LENGTH);
				span.attributes["tool.result"] = truncatedText;
				span.attributes["tool.result_length"] = length;
				span.attributes["tool.output_length"] = length;
			}
		}
	} else if (toolName === "edit") {
		const path = getString(input, "path");
		if (path !== undefined) {
			span.attributes["tool.path"] = path;
		}
		const oldText = getString(input, "oldText");
		if (oldText !== undefined) {
			span.attributes["tool.old_text_length"] = oldText.length;
		}
		const newText = getString(input, "newText");
		if (newText !== undefined) {
			span.attributes["tool.new_text_length"] = newText.length;
		}
		if (isRecord(details)) {
			const diff = getString(details, "diff");
			span.attributes["tool.has_diff"] = diff !== undefined && diff !== "";
			if (diff !== undefined && diff !== "") {
				span.attributes["tool.diff_length"] = diff.length;
			}
			const firstChangedLine = getNumber(details, "firstChangedLine");
			if (firstChangedLine !== undefined) {
				span.attributes["tool.first_changed_line"] = firstChangedLine;
			}
		}
	} else if (toolName === "write") {
		const path = getString(input, "path");
		if (path !== undefined) {
			span.attributes["tool.path"] = path;
		}
		const contentStr = getString(input, "content");
		if (contentStr !== undefined) {
			span.attributes["tool.content_length"] = contentStr.length;
			span.attributes["tool.lines_written"] = contentStr.split("\n").length;
		}
	} else {
		const { text: inputText } = truncate(inputJson, MAX_COMMAND_LENGTH);
		span.attributes["tool.input"] = inputText;

		if (content.length > 0) {
			const imageContent = content.find((c) => c.type === "image");
			span.attributes["tool.has_images"] = imageContent !== undefined;
			if (outputText !== undefined) {
				const { text: truncatedText, length, truncated } = truncate(outputText, MAX_OUTPUT_LENGTH);
				span.attributes["tool.result"] = truncatedText;
				span.attributes["tool.result_length"] = length;
				span.attributes["tool.output_length"] = length;
				span.attributes["tool.truncated"] = truncated;
			}
		}
	}

	if (outputText !== undefined && !("tool.output_length" in span.attributes)) {
		span.attributes["tool.output_length"] = outputText.length;
	}
}

export { addToolSpanAttributes, processToolResult };

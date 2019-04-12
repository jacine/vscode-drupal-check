/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";
import * as path from "path";
import * as spawn from "cross-spawn";
import * as strings from "./base/common/strings";
import * as extfs from "./base/node/extfs";
import CharCode from "./base/common/charcode";

import {
	Diagnostic,
	DiagnosticSeverity,
	Files,
	Range,
	TextDocument
} from "vscode-languageserver";

import { StringResources as SR } from "./strings";
import { CheckerSettings } from './settings';
import { DrupalCheckMessage } from './message';

export class DrupalCheck {

	private executablePath: string;

	private constructor(executablePath: string) {
		this.executablePath = executablePath;
	}

	/**
	 * Create an instance of the PhpcsLinter.
	 */
	static async create(executablePath: string): Promise<DrupalCheck> {
		try {
			return new DrupalCheck(executablePath);

		} catch (error) {
			let message = error.message ? error.message : SR.CreateLinterErrorDefaultMessage;
			throw new Error(strings.format(SR.CreateLinterError, message));
		}
	}

	public async check(document: TextDocument, settings: CheckerSettings): Promise<Diagnostic[]> {

		const { workspaceRoot } = settings;

		// Process linting paths.
		let filePath = Files.uriToFilePath(document.uri);

		// Make sure we capitalize the drive letter in paths on Windows.
		if (filePath !== undefined && /^win/.test(process.platform)) {
			let pathRoot: string = path.parse(filePath).root;
			let noDrivePath = filePath.slice(Math.max(pathRoot.length - 1, 0));
			filePath = path.join(pathRoot.toUpperCase(), noDrivePath);
		}

		let fileText = document.getText();

		// Return empty on empty text.
		if (fileText === '') {
			return [];
		}

		// Process linting arguments.
		let lintArgs = ['--format=json'];
		lintArgs.push(filePath);

		let text = fileText;
		const forcedKillTime = 1000 * 60 * 5; // ms * s * m: 5 minutes
		const options = {
			cwd: workspaceRoot !== null ? workspaceRoot : undefined,
			env: process.env,
			encoding: "utf8",
			timeout: forcedKillTime,
			tty: true,
			input: text,
		};

		const drupalchecker = spawn.sync(this.executablePath, lintArgs, options);
		const stdout = drupalchecker.stdout.toString().trim();
		const stderr = drupalchecker.stderr.toString().trim();
		let match = null;

		// Determine whether we have an error in stderr.
		// if (stderr !== '') {
		// 	if (match = stderr.match(/^(?:PHP\s?)FATAL\s?ERROR:\s?(.*)/i)) {
		// 		let error = match[1].trim();
		// 		if (match = error.match(/^Uncaught exception '.*' with message '(.*)'/)) {
		// 			throw new Error(match[1]);
		// 		}
		// 		throw new Error(error);
		// 	}
		// 	throw new Error(strings.format(SR.UnknownExecutionError, `${this.executablePath} ${lintArgs.join(' ')}`));
		// }

		const data = this.parseData(stdout);

		let messages: Array<DrupalCheckMessage>;
		if (filePath !== undefined) {
			const fileRealPath = extfs.realpathSync(filePath);
			if (!data.files[fileRealPath]) {
				return [];
			}
			({ messages } = data.files[fileRealPath]);
		}

		let diagnostics: Diagnostic[] = [];
		messages.map(message => diagnostics.push(
			this.createDiagnostic(document, message)
		));

		return diagnostics;
	}

	private parseData(text: string) {
		try {
			return JSON.parse(text) as { files: any };
		} catch (error) {
			throw new Error(SR.InvalidJsonStringError);
		}
	}

	private createDiagnostic(document: TextDocument, entry: DrupalCheckMessage): Diagnostic {

		let lines = document.getText().split("\n");
		let line = entry.line - 1;
		let lineString = lines[line];

		// Process diagnostic start and end characters.
		let startCharacter = 0;
		let endCharacter = lineString.length;
		let charCode = lineString.charCodeAt(startCharacter);
		if (CharCode.isWhiteSpace(charCode)) {
			for (let i = startCharacter + 1, len = lineString.length; i < len; i++) {
				charCode = lineString.charCodeAt(i);
				startCharacter = i;
				if (!CharCode.isWhiteSpace(charCode)) {
					break;
				}
			}
		}

		// Process diagnostic range.
		const range: Range = Range.create(line, startCharacter, line, endCharacter);

		// Process diagnostic sources.
		let message: string = entry.message;

		// Process diagnostic severity.
		let severity: DiagnosticSeverity = DiagnosticSeverity.Error;

		return Diagnostic.create(range, message, severity, null, 'drupalchecker');
	}
}
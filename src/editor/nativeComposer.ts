/*!
 * Obsidian Lib and TypeScript Lib — Copyright (C) 2024-2026 Michael Naumov
 * Embedded editor adapted by that library from code by Matthew Meyers and Fevol,
 * Copyright 2024 Matthew Meyers, Fevol.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { EmbeddableMarkdownEditorComponent } from "@mnaoumov/obsidian-lib/components/embeddable-markdown-editor-component";
import type { Extension } from "@codemirror/state";
import type { App } from "obsidian";

/** Keep the dependency on Obsidian's private Markdown editor behind one component. */
export class NativeComposer extends EmbeddableMarkdownEditorComponent {
  constructor(app: App, containerEl: HTMLElement, private extensions: Extension[], onSubmit: () => void) {
    super({
      app,
      containerEl,
      onEnter: ({ isModifierPressed, component }) => {
        if (!isModifierPressed) return false;
        if (!component.editorView.composing && !component.editorView.compositionStarted) onSubmit();
        return true;
      },
    });
  }

  protected override buildExtensions(): Extension[] {
    return [...super.buildExtensions(), ...this.extensions];
  }
}

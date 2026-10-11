# Formatting Guide

The Wrot post editor comes with a toolbar that makes formatting your text a breeze.
With a single click, you can add styling like bold text, lists, and blockquotes.

Here is a breakdown of the formatting tools on the toolbar and what each button does.

Starting with Ver3.0.0, the post editor hides Markdown syntax and shows your text already styled. For how deleting, stacking styles, and other editor behaviors work, see [New Posting Form in Ver3.0.0 and Up](./posting-form-v3.md).

---

## Toolbar Layout

By default, the bottom of the editor features the following tools, from left to right:

| Icon  | Feature           | What Gets Saved / What It Does                                           |
| :---: | :---------------- | :----------------------------------------------------------------------- |
|  🖼️   | **Image**         | Opens a window to choose and attach an image                             |
| **B** | **Bold**          | `**Bold**`                                                               |
|  _I_  | **Italic**        | `*Italic*`                                                               |
|  ☰   | **List**          | `- Bullet point`                                                         |
|   ☑   | **Checklist**     | `- [ ] Task`                                                             |
|  1.   | **Numbered List** | `1. Numbered`                                                            |
|   ⋯   | **More**          | Pin later, Code, Math, Quote, Link, Strikethrough, Highlight, and more   |

- You can customize which buttons show up on the toolbar and rearrange them. To learn how, check out [How to Use the Toolbar](./toolbar.md).

---

## Bold and Italic

### When Text Is Selected

Makes the selected text bold (italic). Click the button again to remove it.

- You can also apply it to text that already has other formatting. Bold and italic can be combined, too.

### When Pressed Without Selecting Text

Clicking the button lights it up, and whatever you type next is shown in bold (italic). Click the button again to close the formatting.

- Pressing `Backspace` before typing anything cancels it.
- If you post without closing it, the formatting is closed automatically at the end of that line.
- While one of them is lit up, the other button (italic for bold, and vice versa) is unavailable.
- While you are converting text with an IME (such as Japanese input), the lit-up button pauses briefly so you do not close the formatting by accident.

---

## Lists (Bullets, Checklists, Numbered)

Clicking a list button turns **the line your cursor is on** into a list item (the marker goes at the start of the line even if your cursor is in the middle). Click it again to turn the line back, or click a different list button to switch the type.

| Button            | Saved Marker |
| :---------------- | :----------- |
| **List**          | `- `         |
| **Checklist**     | `- [ ] `     |
| **Numbered List** | `1. `        |

- Clicking a list button on a quote line creates a list inside the quote.
- For continuing lists with `Enter` and changing indentation with `Tab` or `Backspace`, see "6. Managing Lists and Quotes" in [New Posting Form in Ver3.0.0 and Up](./posting-form-v3.md).

---

## More Formatting Options (⋯)

### Code

The editor switches between inline code and a code block depending on whether text is selected.

| Selection Status  | What Gets Saved                                   |
| :---------------- | :------------------------------------------------ |
| **Text selected** | <code>\`Selected Text\`</code> (inline code)      |
| **No selection**  | <code>~~~</code> to <code>~~~</code> (code block) |

- When you insert a code block, your cursor lands inside it so you can start typing right away.
- It cannot be applied to text that has formatting or a link (the button is greyed out).

### Math (LaTeX)

Just like code, this switches between inline math and a math block depending on whether text is selected.

| Selection Status  | What Gets Saved                 |
| :---------------- | :------------------------------ |
| **Text selected** | `$Selected Text$` (inline math) |
| **No selection**  | `$$ … $$` (math block)          |

- It cannot be applied to text that has formatting or a link (the button is greyed out).

### Quote

Adds or removes the quote marker `>` at the start of your current line or selected lines.

- Selecting multiple lines adds it to every selected line.
- If every selected line is already a quote, clicking the button removes it from all of them at once.

### Link

Available when text is selected, or when your cursor is on a link.

A small pop-up field opens below the editor. Type a note name or a URL and press `Enter` to confirm. For details, see "7. Inserting and Editing Links" in [New Posting Form in Ver3.0.0 and Up](./posting-form-v3.md).

### Strikethrough

**Only available when text is selected** (greyed out otherwise). Click it again to remove it.

| Feature           | Saved Format |
| :---------------- | :----------- |
| **Strikethrough** | `~~Text~~`   |

### Highlight

**Only available when text is selected** (greyed out otherwise).

- Clicking it opens a color menu: **Default, Red, Orange, Yellow, Green, Blue, Purple**. Default uses your theme's highlight color.
- When the selected text is already highlighted, the menu item becomes **Remove highlight**, and clicking it removes the highlight.

| Color                     | Saved Format                                        |
| :------------------------ | :-------------------------------------------------- |
| **Default**               | `==Text==`                                          |
| **The six colors**        | `==🔴Text==` and so on (the same syntax as Obsidian) |

---

## Rules That Apply to All Formatting

- **Half-width spaces before and after**: Applying formatting automatically adds a space before and after it (skipped when there is already a space, among other cases).
- **Stacking**: Applying formatting to text that already has some stacks the two. Clicking the same button removes only that formatting.
- **Code and math**: Code and math cannot be combined with other formatting.

For the exact conditions, see "5. Toolbar Formatting Rules" in [New Posting Form in Ver3.0.0 and Up](./posting-form-v3.md).

---

## Images and Links

For a detailed walkthrough on attaching images (🖼️) and linking to notes and web pages, check out the guide below.

👉 [Working with Images, Links, and Embeds](./links-and-embeds.md)

---

## Keyboard Shortcuts

- **Post**: `Ctrl + Enter` / `Cmd + Enter` (or click the post button)

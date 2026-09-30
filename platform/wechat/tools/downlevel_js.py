"""Rewrite syntax WeChat's preview parser rejects.

The Developer Tools simulator runs this glue, but packaging a preview fails on
optional chaining, nullish and logical assignment, class fields, and object
spread. The replacement stays within the syntax the packager already accepts.
"""

from __future__ import annotations

OPTIONAL_NAME = "__godotOptional"


def downlevel_wechat_js(source: str) -> str:
    text = source
    while True:
        found = _find_operator(text)
        if found is None:
            break
        start, kind = found
        if kind == "??=":
            text = _replace_assign(text, start, 3, "{name} != null ? {name} : {rhs}")
        elif kind in ("||=", "&&="):
            op = "||" if kind == "||=" else "&&"
            text = _replace_assign(text, start, 3, "{name} " + op + " {rhs}")
        elif kind == "??":
            text = _replace_nullish(text, start)
        else:
            text = _replace_optional(text, start)
    text = _downlevel_class_fields(text)
    return _downlevel_object_spread(text)


def _find_operator(source: str) -> tuple[int, str] | None:
    i = 0
    state = "code"
    previous = "start"
    while i < len(source):
        if state == "code":
            char = source[i]
            if char == "/" and previous != "value" and _starts_regex(source, i):
                i = _skip_regex(source, i + 1)
                previous = "value"
                continue
            found = _operator_at(source, i)
            if found is not None:
                return i, found
            if char.strip() != "" and char not in "([{":
                if char in ")]." or char.isalnum() or char in "_$":
                    previous = "value"
                else:
                    previous = "other"
        state, step = _step(source, i, state)
        i += step
    return None


def _operator_at(source: str, index: int) -> str | None:
    for token in ("||=", "&&=", "??=", "??", "?."):
        if source.startswith(token, index):
            return token
    return None


def _starts_regex(source: str, index: int) -> bool:
    nxt = index + 1
    if nxt >= len(source):
        return False
    if source[nxt] in ("/", "*"):
        return False
    return True


def _skip_regex(source: str, index: int) -> int:
    while index < len(source):
        if source[index] == "\\":
            index += 2
            continue
        if source[index] == "/":
            index += 1
            while index < len(source) and source[index].isalpha():
                index += 1
            return index
        if source[index] == "[":
            index += 1
            while index < len(source) and source[index] != "]":
                if source[index] == "\\":
                    index += 2
                    continue
                index += 1
        index += 1
    return index


def _replace_optional(source: str, operator: int) -> str:
    lhs = _expression_before(source, operator)
    cursor = _skip_space(source, operator + 2)
    if cursor < len(source) and source[cursor] == "(":
        end = _matching_close(source, cursor, "(", ")") + 1
        args = source[cursor + 1 : end - 1]
        access = f"{OPTIONAL_NAME}({args})"
    elif cursor < len(source) and source[cursor] == "[":
        end = _matching_close(source, cursor, "[", "]") + 1
        access = f"{OPTIONAL_NAME}{source[cursor:end]}"
    else:
        ident = _read_identifier(source, cursor)
        end = cursor + len(ident)
        access = f"{OPTIONAL_NAME}.{ident}"
    # a?.b.c short-circuits the whole chain, including property access after ?.
    end, access = _extend_optional_chain(source, end, access)
    body = f"return {OPTIONAL_NAME} == null ? void 0 : {access};"
    return _wrap(source, lhs, operator, end, body)


def _extend_optional_chain(source: str, end: int, access: str) -> tuple[int, str]:
    while True:
        cursor = _skip_space(source, end)
        if cursor >= len(source) or source.startswith("?.", cursor):
            return end, access
        if source[cursor] == ".":
            ident_at = _skip_space(source, cursor + 1)
            ident = _read_identifier(source, ident_at)
            access += "." + ident
            end = ident_at + len(ident)
            continue
        if source[cursor] == "[":
            end = _matching_close(source, cursor, "[", "]") + 1
            access += source[cursor:end]
            continue
        if source[cursor] == "(":
            end = _matching_close(source, cursor, "(", ")") + 1
            access += source[cursor:end]
            continue
        return end, access


def _replace_nullish(source: str, operator: int) -> str:
    lhs = _expression_before(source, operator)
    rhs_end = _expression_after(source, operator + 2)
    rhs = source[operator + 2 : rhs_end].strip()
    body = f"return {OPTIONAL_NAME} != null ? {OPTIONAL_NAME} : {rhs};"
    return _wrap(source, lhs, operator, rhs_end, body)


def _wrap(source: str, lhs: int, operator: int, end: int, body: str) -> str:
    target = source[lhs:operator].strip()
    call = f"(function({OPTIONAL_NAME}){{ {body} }}({target}))"
    return source[:lhs] + call + source[end:]



def _replace_assign(source: str, operator: int, length: int, expression: str) -> str:
    lhs = _expression_before(source, operator)
    rhs_end = _expression_after(source, operator + length)
    target = source[lhs:operator].strip()
    rhs = source[operator + length : rhs_end].strip()
    body = "return " + expression.format(name=OPTIONAL_NAME, rhs=rhs) + ";"
    replacement = (
        f"{target} = (function({OPTIONAL_NAME}){{ {body} }}({target}))"
    )
    return source[:lhs] + replacement + source[rhs_end:]


def _expression_before(source: str, operator: int) -> int:
    i = operator - 1
    # Do not walk into the previous line. A // comment can end in a dot.
    while i >= 0 and source[i] in " \t":
        i -= 1
    return _walk_back(source, i)


def _walk_back(source: str, index: int) -> int:
    if source[index] in ")]":
        open_char = "(" if source[index] == ")" else "["
        index = _matching_open(source, index, open_char, source[index])
        return _continue_member(source, index)
    if source[index] in "'\"" or source[index] == "`":
        quote = source[index]
        index -= 1
        while index >= 0 and source[index] != quote:
            index -= 1
        return index
    if source[index].isalnum() or source[index] in "_$":
        while index >= 0 and (source[index].isalnum() or source[index] in "_$"):
            index -= 1
        return _continue_member(source, index + 1)
    raise ValueError(f"unsupported left-hand side before {source[index:index + 12]!r}")


def _continue_member(source: str, start: int) -> int:
    i = start - 1
    while i >= 0 and source[i] in " \t":
        i -= 1
    if i >= 0 and source[i] == ".":
        return _walk_back(source, i - 1)
    # Module['name'] and obj[index] keep the object in the left-hand side.
    if start < len(source) and source[start] == "[" and i >= 0 and (source[i].isalnum() or source[i] in "_$)]"):
        return _walk_back(source, i)
    return start


def _expression_after(source: str, start: int) -> int:
    i = _skip_space(source, start)
    depth_paren = 0
    depth_bracket = 0
    depth_brace = 0
    state = "code"
    while i < len(source):
        if state != "code":
            state, step = _step(source, i, state)
            i += step
            continue
        char = source[i]
        if (
            char == "/"
            and depth_paren == depth_bracket == depth_brace == 0
            and _starts_regex(source, i)
        ):
            i = _skip_regex(source, i + 1)
            continue
        if char == "(":
            depth_paren += 1
        elif char == ")":
            if depth_paren == depth_bracket == depth_brace == 0:
                return i
            depth_paren -= 1
        elif char == "[":
            depth_bracket += 1
        elif char == "]":
            if depth_bracket == depth_paren == depth_brace == 0:
                return i
            depth_bracket -= 1
        elif char == "{":
            depth_brace += 1
        elif char == "}":
            if depth_brace == depth_paren == depth_bracket == 0:
                return i
            depth_brace -= 1
        elif depth_paren == depth_bracket == depth_brace == 0 and _ends_rhs(source, i):
            return i
        state, step = _step(source, i, state)
        i += step
    return i


def _ends_rhs(source: str, index: int) -> bool:
    char = source[index]
    if char == "\n" and not _continues_after_newline(source, index + 1):
        return True
    if source.startswith("??", index):
        return True
    return _ends_expression(source, index)


def _continues_after_newline(source: str, index: int) -> bool:
    while index < len(source) and source[index] in " \t\r":
        index += 1
    if index >= len(source) or source[index] == "\n":
        return False
    if source.startswith(("?.", "??", "&&", "||", "==", "!=", "<=", ">=", "=>", "++", "--"), index):
        return True
    return source[index] in "+-*/%.<>=&|^?(["


def _ends_expression(source: str, index: int) -> bool:
    char = source[index]
    if char in ",;:":
        return True
    if char == "?" and not source.startswith("?.", index) and not source.startswith("??", index):
        return True
    if source.startswith("||", index):
        return True
    if char == "=" and not source.startswith("==", index) and not source.startswith("=>", index):
        previous = source[index - 1] if index else ""
        if previous not in "=!<>":
            return True
    return False


def _matching_close(source: str, open_index: int, open_char: str, close_char: str) -> int:
    depth = 0
    i = open_index
    while i < len(source):
        if source[i] == open_char:
            depth += 1
        elif source[i] == close_char:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError("unbalanced " + open_char)


def _matching_open(source: str, close_index: int, open_char: str, close_char: str) -> int:
    depth = 0
    i = close_index
    while i >= 0:
        if source[i] == close_char:
            depth += 1
        elif source[i] == open_char:
            depth -= 1
            if depth == 0:
                return i
        i -= 1
    raise ValueError("unbalanced " + close_char)


def _read_identifier(source: str, start: int) -> str:
    i = start
    while i < len(source) and (source[i].isalnum() or source[i] in "_$"):
        i += 1
    if i == start:
        raise ValueError(f"expected a property name at {source[start:start + 12]!r}")
    return source[start:i]


def _skip_space(source: str, index: int) -> int:
    while index < len(source) and source[index] in " \t\r\n":
        index += 1
    return index


def _downlevel_class_fields(source: str) -> str:
    for open_brace, close_brace in reversed(_class_spans(source)):
        body = source[open_brace + 1 : close_brace]
        rewritten = _rewrite_class_body(body)
        if rewritten != body:
            source = source[: open_brace + 1] + rewritten + source[close_brace:]
    return source


def _class_spans(source: str) -> list[tuple[int, int]]:
    spans = []
    i = 0
    state = "code"
    while i < len(source):
        if state == "code" and _word_at(source, i, "class"):
            brace = source.find("{", i)
            if brace < 0:
                break
            close = _matching_close(source, brace, "{", "}")
            spans.append((brace, close))
            i = brace + 1
            continue
        state, step = _step(source, i, state)
        i += step
    return spans


def _rewrite_class_body(body: str) -> str:
    fields: list[tuple[str, str]] = []
    out: list[str] = []
    i = 0
    depth = 0
    paren = 0
    bracket = 0
    state = "code"
    while i < len(body):
        # Parameter defaults such as `options = {}` are not class fields.
        if state == "code" and depth == 0 and paren == 0 and bracket == 0 and _field_at(body, i):
            name, expr, end = _read_field(body, i)
            fields.append((name, expr))
            i = end
            continue
        if state == "code":
            if body[i] == "{":
                depth += 1
            elif body[i] == "}":
                depth -= 1
            elif body[i] == "(":
                paren += 1
            elif body[i] == ")" and paren:
                paren -= 1
            elif body[i] == "[":
                bracket += 1
            elif body[i] == "]" and bracket:
                bracket -= 1
        state, step = _step(body, i, state)
        out.append(body[i : i + step])
        i += step
    if not fields:
        return body
    rewritten = "".join(out)
    assignments = "".join(f"this.{name} = {expr};\n" for name, expr in fields)
    constructor = _find_constructor(rewritten)
    if constructor is None:
        return "constructor() {\n" + assignments + "}\n" + rewritten
    brace, super_end = constructor
    insert_at = brace + 1 if super_end is None else super_end
    return rewritten[:insert_at] + "\n" + assignments + rewritten[insert_at:]


def _field_at(source: str, index: int) -> bool:
    if index > 0 and (source[index - 1].isalnum() or source[index - 1] in "_$."):
        return False
    if not (source[index].isalpha() or source[index] in "_$"):
        return False
    name = _read_identifier(source, index)
    if name in ("get", "set", "static", "async", "constructor"):
        return False
    cursor = _skip_space(source, index + len(name))
    return cursor < len(source) and source[cursor] == "=" and not source.startswith(("==", "=>"), cursor)


def _read_field(source: str, index: int) -> tuple[str, str, int]:
    name = _read_identifier(source, index)
    cursor = _skip_space(source, index + len(name))
    expr_start = _skip_space(source, cursor + 1)
    expr_end = _expression_after(source, expr_start)
    expr = source[expr_start:expr_end].strip()
    end = expr_end + 1 if expr_end < len(source) and source[expr_end] == ";" else expr_end
    return name, expr, end


def _find_constructor(body: str) -> tuple[int, int | None] | None:
    i = 0
    depth = 0
    state = "code"
    while i < len(body):
        if state == "code" and depth == 0 and _word_at(body, i, "constructor"):
            paren = body.find("(", i)
            brace = body.find("{", paren)
            return brace, _super_statement_end(body, brace + 1)
        if state == "code" and body[i] == "{":
            depth += 1
        elif state == "code" and body[i] == "}":
            depth -= 1
        state, step = _step(body, i, state)
        i += step
    return None


def _super_statement_end(source: str, start: int) -> int | None:
    i = _skip_space(source, start)
    if not _word_at(source, i, "super"):
        return None
    paren = source.find("(", i)
    close = _matching_close(source, paren, "(", ")") + 1
    if close < len(source) and source[close] == ";" :
        close += 1
    return close


def _downlevel_object_spread(source: str) -> str:
    out: list[str] = []
    i = 0
    state = "code"
    while i < len(source):
        if state == "code" and source.startswith("{...", i):
            expr_end = _expression_after(source, i + 4)
            if expr_end < len(source) and source[expr_end] == "}":
                expr = source[i + 4 : expr_end].strip()
                out.append(f"Object.assign({{}}, {expr})")
                i = expr_end + 1
                continue
        state, step = _step(source, i, state)
        out.append(source[i : i + step])
        i += step
    return "".join(out)


def _word_at(source: str, index: int, word: str) -> bool:
    if not source.startswith(word, index):
        return False
    before = source[index - 1] if index else ""
    after_index = index + len(word)
    after = source[after_index] if after_index < len(source) else ""
    return not (before.isalnum() or before in "_$") and not (after.isalnum() or after in "_$")


def _step(source: str, index: int, state: str) -> tuple[str, int]:
    if index >= len(source):
        return state, 1
    if state == "line":
        return ("code", 1) if source[index] == "\n" else (state, 1)
    if state == "block":
        return ("code", 2) if source.startswith("*/", index) else (state, 1)
    if state in ("single", "double", "template"):
        if source[index] == "\\":
            return state, 2
        quote = {"single": "'", "double": '"', "template": "`"}[state]
        return ("code", 1) if source[index] == quote else (state, 1)
    if source.startswith("//", index):
        return "line", 2
    if source.startswith("/*", index):
        return "block", 2
    if source[index] in ("'", '"', "`"):
        return {"'": "single", '"': "double", "`": "template"}[source[index]], 1
    return "code", 1

def code_without_strings_and_comments(source: str) -> str:
    out = []
    i = 0
    state = "code"
    while i < len(source):
        next_state, step = _step(source, i, state)
        if state == "code" and next_state == "code":
            out.append(source[i : i + step])
        state = next_state
        i += step
    return "".join(out)



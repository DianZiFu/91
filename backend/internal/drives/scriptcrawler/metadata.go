package scriptcrawler

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	maxCrawlerNameRunes      = 80
	maxMetadataPreambleLines = 200
)

const (
	ProtocolV3 = "crawler.v3"
)

type Metadata struct {
	Name     string `json:"name"`
	Protocol string `json:"protocol"`
	Feeds    []Feed `json:"feeds"`
}

func ReadMetadata(scriptPath string) (Metadata, error) {
	scriptPath = strings.TrimSpace(scriptPath)
	if scriptPath == "" {
		return Metadata{}, errors.New("脚本路径为空")
	}
	if filepath.Ext(scriptPath) != ".py" {
		return Metadata{}, errors.New("目前只支持 .py 爬虫脚本")
	}
	data, err := os.ReadFile(scriptPath)
	if err != nil {
		return Metadata{}, fmt.Errorf("读取脚本失败: %w", err)
	}
	return ExtractMetadata(string(data))
}

func ExtractMetadata(source string) (Metadata, error) {
	lines := strings.Split(source, "\n")
	preamble := min(len(lines), maxMetadataPreambleLines)

	meta := Metadata{Feeds: []Feed{{ID: "default", Label: "默认", Default: true}}}
	foundName := false
	foundFeeds := false
	tripleQuote := ""
	for _, line := range lines[:preamble] {
		key, value, ok := moduleLevelMetadataAssignment(line, &tripleQuote)
		if !ok {
			continue
		}
		switch key {
		case "CRAWLER_FEEDS":
			if foundFeeds {
				return Metadata{}, errors.New("CRAWLER_FEEDS 只能声明一次")
			}
			literal, ok := parsePythonStringLiteral(value)
			if !ok {
				return Metadata{}, errors.New("CRAWLER_FEEDS 必须是单行 JSON 字符串字面量")
			}
			feeds, err := parseFeeds(literal)
			if err != nil {
				return Metadata{}, err
			}
			meta.Feeds = feeds
			foundFeeds = true
		case "CRAWLER_NAME":
			name, ok := parsePythonStringLiteral(value)
			if !ok {
				return Metadata{}, errors.New(`CRAWLER_NAME 必须是字符串字面量，例如 CRAWLER_NAME = "示例爬虫"`)
			}
			name = strings.TrimSpace(name)
			if name == "" {
				return Metadata{}, errors.New("CRAWLER_NAME 不能为空")
			}
			if len([]rune(name)) > maxCrawlerNameRunes {
				return Metadata{}, fmt.Errorf("CRAWLER_NAME 不能超过 %d 个字符", maxCrawlerNameRunes)
			}
			meta.Name = name
			foundName = true
		case "CRAWLER_PROTOCOL":
			protocol, ok := parsePythonStringLiteral(value)
			if !ok {
				return Metadata{}, errors.New(`CRAWLER_PROTOCOL 必须是字符串字面量，例如 CRAWLER_PROTOCOL = "crawler.v3"`)
			}
			protocol = strings.TrimSpace(protocol)
			if protocol != ProtocolV3 {
				return Metadata{}, fmt.Errorf("不支持的 CRAWLER_PROTOCOL %q，仅支持 %s，请升级脚本", protocol, ProtocolV3)
			}
			meta.Protocol = protocol
		}
	}
	if err := rejectIgnoredMetadata(lines[preamble:], &tripleQuote, meta, foundName); err != nil {
		return Metadata{}, err
	}
	if !foundName {
		return Metadata{}, fmt.Errorf(`脚本必须在前 %d 行的模块顶层声明 CRAWLER_NAME，例如 CRAWLER_NAME = "示例爬虫"`, maxMetadataPreambleLines)
	}
	if meta.Protocol != ProtocolV3 {
		return Metadata{}, fmt.Errorf("必须显式声明 CRAWLER_PROTOCOL = %q，旧协议不再支持", ProtocolV3)
	}
	return meta, nil
}

// Reject declarations that the bounded module preamble cannot validate.
func rejectIgnoredMetadata(lines []string, tripleQuote *string, meta Metadata, foundName bool) error {
	for _, line := range lines {
		key, value, ok := moduleLevelMetadataAssignment(line, tripleQuote)
		if !ok {
			continue
		}
		if key == "CRAWLER_FEEDS" {
			return fmt.Errorf("CRAWLER_FEEDS 必须在前 %d 行模块顶层声明，且只能声明一次", maxMetadataPreambleLines)
		}
		literal, ok := parsePythonStringLiteral(value)
		if key == "CRAWLER_PROTOCOL" && (!ok || literal != meta.Protocol) {
			return fmt.Errorf("CRAWLER_PROTOCOL 必须在前 %d 行模块顶层声明，且只能为 %s", maxMetadataPreambleLines, ProtocolV3)
		}
		if key == "CRAWLER_NAME" && !foundName {
			return fmt.Errorf("CRAWLER_NAME 必须在前 %d 行模块顶层声明", maxMetadataPreambleLines)
		}
	}
	return nil
}

// moduleLevelMetadataAssignment reports a top-level crawler metadata
// assignment on one line, returning the raw right-hand side.
// Indented assignments belong to a function or class body and are ignored, as
// are comments and triple-quoted regions.
func moduleLevelMetadataAssignment(line string, tripleQuote *string) (string, string, bool) {
	code := stripPythonTripleQuotedText(line, tripleQuote)
	if code == "" || code[0] == ' ' || code[0] == '\t' {
		return "", "", false
	}
	trimmed := strings.TrimSpace(code)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return "", "", false
	}
	if !strings.HasPrefix(trimmed, "CRAWLER_") {
		return "", "", false
	}
	left, right, ok := strings.Cut(trimmed, "=")
	if !ok {
		return "", "", false
	}
	key := strings.TrimSpace(left)
	if key != "CRAWLER_NAME" && key != "CRAWLER_PROTOCOL" && key != "CRAWLER_FEEDS" {
		return "", "", false
	}
	return key, right, true
}

// stripPythonTripleQuotedText removes module docstrings and other triple-quoted
// regions while preserving ordinary quoted literals used by metadata
// assignments. It is intentionally a small preamble lexer rather than a full
// Python parser.
func stripPythonTripleQuotedText(line string, tripleQuote *string) string {
	var out strings.Builder
	for i := 0; i < len(line); {
		if *tripleQuote != "" {
			end := strings.Index(line[i:], *tripleQuote)
			if end < 0 {
				return out.String()
			}
			i += end + len(*tripleQuote)
			*tripleQuote = ""
			continue
		}
		if line[i] == '#' {
			out.WriteString(line[i:])
			break
		}
		if i+3 <= len(line) && (line[i:i+3] == `"""` || line[i:i+3] == `'''`) {
			*tripleQuote = line[i : i+3]
			i += 3
			continue
		}
		if line[i] == '"' || line[i] == '\'' {
			quote := line[i]
			out.WriteByte(line[i])
			i++
			escaped := false
			for i < len(line) {
				ch := line[i]
				out.WriteByte(ch)
				i++
				if escaped {
					escaped = false
					continue
				}
				if ch == '\\' {
					escaped = true
					continue
				}
				if ch == quote {
					break
				}
			}
			continue
		}
		out.WriteByte(line[i])
		i++
	}
	return out.String()
}

func parsePythonStringLiteral(raw string) (string, bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", false
	}
	rawString := false
	for len(s) > 0 {
		switch s[0] {
		case 'r', 'R':
			rawString = true
			s = strings.TrimSpace(s[1:])
		case 'u', 'U', 'b', 'B':
			s = strings.TrimSpace(s[1:])
		default:
			goto parseQuote
		}
	}

parseQuote:
	if len(s) < 2 || (s[0] != '"' && s[0] != '\'') {
		return "", false
	}
	quote := s[0]
	var b strings.Builder
	escaped := false
	for i := 1; i < len(s); i++ {
		ch := s[i]
		if escaped {
			switch {
			case rawString:
				b.WriteByte('\\')
				b.WriteByte(ch)
			case ch == 'n':
				b.WriteByte('\n')
			case ch == 'r':
				b.WriteByte('\r')
			case ch == 't':
				b.WriteByte('\t')
			case ch == '\\' || ch == quote || ch == '"' || ch == '\'':
				b.WriteByte(ch)
			default:
				b.WriteByte(ch)
			}
			escaped = false
			continue
		}
		if ch == '\\' {
			escaped = true
			continue
		}
		if ch == quote {
			tail := strings.TrimSpace(s[i+1:])
			if tail != "" && !strings.HasPrefix(tail, "#") {
				return "", false
			}
			return b.String(), true
		}
		b.WriteByte(ch)
	}
	return "", false
}

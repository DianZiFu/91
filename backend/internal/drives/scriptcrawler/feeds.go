package scriptcrawler

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

type Feed struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Default bool   `json:"default,omitempty"`
}

var feedIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

func parseFeeds(raw string) ([]Feed, error) {
	if len(raw) > 64*1024 {
		return nil, errors.New("CRAWLER_FEEDS 不能超过 64 KiB")
	}
	var feeds []Feed
	if err := strictDecode([]byte(raw), &feeds); err != nil {
		return nil, fmt.Errorf("CRAWLER_FEEDS 必须是有效的栏目 JSON 数组: %w", err)
	}
	if len(feeds) == 0 || len(feeds) > 64 {
		return nil, errors.New("CRAWLER_FEEDS 必须包含 1–64 个栏目")
	}
	ids := map[string]bool{}
	defaults := 0
	for _, feed := range feeds {
		if !feedIDPattern.MatchString(feed.ID) || ids[feed.ID] {
			return nil, fmt.Errorf("CRAWLER_FEEDS 栏目 ID %q 无效或重复；使用 1–64 位字母、数字、下划线或短横线，并以字母或数字开头", feed.ID)
		}
		ids[feed.ID] = true
		if strings.TrimSpace(feed.Label) == "" || strings.TrimSpace(feed.Label) != feed.Label || len([]rune(feed.Label)) > 80 || strings.ContainsFunc(feed.Label, unicode.IsControl) {
			return nil, errors.New("CRAWLER_FEEDS 栏目名称必须为 1–80 个字符，不能含首尾空白或控制字符")
		}
		if feed.Default {
			defaults++
		}
	}
	if defaults != 1 {
		return nil, errors.New("CRAWLER_FEEDS 必须且只能有一个 default 为 true 的栏目")
	}
	return feeds, nil
}

// ResolveFeed applies the default only when there is no saved selection.
// A removed selection must never silently switch the crawler to another feed.
func (m Metadata) ResolveFeed(id string) (Feed, error) {
	for _, feed := range m.Feeds {
		if feed.ID == id || id == "" && feed.Default {
			return feed, nil
		}
	}
	return Feed{}, fmt.Errorf("脚本不支持抓取栏目 %q，请重新选择", id)
}

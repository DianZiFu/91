package scriptcrawler

import (
	"strings"
	"testing"
)

func TestExtractMetadataRequiresExplicitV3(t *testing.T) {
	for _, protocol := range []string{"", "crawler.v1", "crawler.v2", "crawler.v4"} {
		t.Run(protocol, func(t *testing.T) {
			source := "CRAWLER_NAME = 'Test'\n"
			if protocol != "" {
				source += "CRAWLER_PROTOCOL = '" + protocol + "'\n"
			}
			if _, err := ExtractMetadata(source); err == nil || !strings.Contains(err.Error(), "CRAWLER_PROTOCOL") {
				t.Fatalf("accepted %q: %v", protocol, err)
			}
		})
	}
	meta, err := ExtractMetadata("CRAWLER_NAME = '示例爬虫'\nCRAWLER_PROTOCOL = 'crawler.v3'\n")
	if err != nil || meta.Protocol != ProtocolV3 || meta.Name != "示例爬虫" {
		t.Fatalf("%+v %v", meta, err)
	}
}
func TestExtractMetadataIgnoresIndentedAndDocstringAssignments(t *testing.T) {
	source := `"""
CRAWLER_PROTOCOL = "crawler.v1"
"""
CRAWLER_NAME = "Test"
CRAWLER_PROTOCOL = "crawler.v3"
def example():
    CRAWLER_PROTOCOL = dynamic()
`
	if _, err := ExtractMetadata(source); err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{`CRAWLER_NAME = ""
CRAWLER_PROTOCOL = "crawler.v3"`, `CRAWLER_NAME = "Test"
CRAWLER_PROTOCOL = "crawler." + "v3"`, "CRAWLER_NAME = 'Test'\n" + strings.Repeat("# filler\n", maxMetadataPreambleLines) + "CRAWLER_PROTOCOL = 'crawler.v3'\n"} {
		if _, err := ExtractMetadata(source); err == nil {
			t.Fatal("accepted invalid metadata")
		}
	}
}

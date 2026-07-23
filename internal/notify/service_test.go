package notify

import (
	"testing"
	"time"

	"github.com/wang4386/CDT-Monitor/internal/domain"
)

func TestReplacementsExposeWebhookVariables(t *testing.T) {
	event := domain.NotificationEvent{
		Type:      "threshold",
		Title:     "流量阈值告警",
		Summary:   "即将达到阈值",
		AccountID: 42,
		Fields: map[string]string{
			"当前流量": "12.3456 GB",
			"设定阈值": "95%",
			"实例":   "i-test",
			"实例状态": "Running",
		},
		CreatedAt: time.Date(2026, 7, 23, 8, 9, 10, 0, time.FixedZone("CST", 8*60*60)),
	}
	values := replacements(event)
	for key, want := range map[string]string{
		"#TITLE#": "流量阈值告警", "#MSG#": "即将达到阈值", "#ACCOUNT#": "42", "#ACCOUNT_ID#": "42",
		"#TRAFFIC#": "12.3456", "#MAX_TRAFFIC#": "95", "#INSTANCE#": "i-test", "#STATUS#": "Running", "#TYPE#": "threshold",
	} {
		if values[key] != want {
			t.Fatalf("%s = %q, want %q", key, values[key], want)
		}
	}
	if values["#CREATED_AT#"] != "2026-07-23T00:09:10Z" {
		t.Fatalf("#CREATED_AT# = %q", values["#CREATED_AT#"])
	}
}

func TestReplaceTemplateJSONAndForm(t *testing.T) {
	replacements := map[string]string{"#MSG#": "hello world", "#TITLE#": "通知"}
	if got := replaceTemplate("msg=#MSG#", replacements, true); got != "msg=hello+world" {
		t.Fatalf("form replacement = %q", got)
	}
	if got := replaceTemplate(`{"message":"#MSG#"}`, replacements, false); got != `{"message":"hello world"}` {
		t.Fatalf("json replacement = %q", got)
	}
}

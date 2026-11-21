package k8s

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

var incidentHTTPClient = &http.Client{
	Timeout: 5 * time.Second,
}

// dispatchIncidentToApiServer forwards an active alert violation event to the api-server
// REST endpoint POST /api/v1/incidents/internal/trigger to persist the incident in PostgreSQL.
func dispatchIncidentToApiServer(clusterID string, event types.AlertTriggeredEvent) {
	apiServerURL := os.Getenv("API_SERVER_URL")
	if apiServerURL == "" {
		apiServerURL = "http://localhost:3000"
	}

	token, err := websocket.CreateServiceToken()
	if err != nil {
		log.Printf("[Incident Dispatcher] Warning: could not generate service token: %v", err)
		return
	}

	payload := map[string]interface{}{
		"ruleId":     event.RuleID,
		"clusterId":  clusterID,
		"targetKind": event.TargetKind,
		"targetName": event.TargetName,
		"namespace":  event.Namespace,
		"measured":   event.Measured,
		"threshold":  event.Threshold,
		"severity":   event.Severity,
		"message":    event.Message,
		"timestamp":  event.Timestamp,
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Incident Dispatcher] Failed to marshal incident payload: %v", err)
		return
	}

	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		fmt.Sprintf("%s/api/v1/incidents/internal/trigger", apiServerURL),
		bytes.NewReader(bodyBytes),
	)
	if err != nil {
		log.Printf("[Incident Dispatcher] Failed to build HTTP request: %v", err)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	resp, err := incidentHTTPClient.Do(req)
	if err != nil {
		log.Printf("[Incident Dispatcher] HTTP POST failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		log.Printf("[Incident Dispatcher] Incident successfully recorded in PostgreSQL for rule=%s target=%s",
			event.RuleID, event.TargetName)
	} else {
		log.Printf("[Incident Dispatcher] API server returned HTTP %d for rule=%s", resp.StatusCode, event.RuleID)
	}
}

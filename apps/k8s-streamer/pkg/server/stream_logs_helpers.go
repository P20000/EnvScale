package server

import (
	"time"

	corev1 "k8s.io/api/core/v1"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
)

func isContainerTerminated(pod *corev1.Pod, containerName string, isInit bool) (bool, int32) {
	return k8s.IsContainerTerminated(pod, containerName, isInit)
}

func isContainerWaiting(pod *corev1.Pod, containerName string, isInit bool) (bool, string) {
	return k8s.IsContainerWaiting(pod, containerName, isInit)
}

func parseLogTimestamp(raw string) (string, time.Time, string, string) {
	return k8s.ParseLogTimestamp(raw)
}

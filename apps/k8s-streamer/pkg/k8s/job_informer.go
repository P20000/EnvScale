package k8s

import (
	"fmt"
	"log"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// setupJobInformer registers the batchv1.Job informer and its event listeners.
func (im *InformerManager) setupJobInformer() {
	jobInformer := im.factory.Batch().V1().Jobs().Informer()

	jobInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if job, ok := obj.(*batchv1.Job); ok {
				im.emitJobDelta(job)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if job, ok := newObj.(*batchv1.Job); ok {
				im.emitJobDelta(job)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if job, ok := obj.(*batchv1.Job); ok {
				im.emitJobDeleted(job)
			}
		},
	})
}

// extractJobDelta extracts status delta for standalone jobs.
// Returns (delta, true) if it is a standalone job, or (delta, false) if it is owned by a CronJob.
func (im *InformerManager) extractJobDelta(job *batchv1.Job) (types.JobStatusDelta, bool) {
	// GOTCHA 2 RULE: If job is owned by a CronJob, do NOT emit as a standalone root job card
	for _, owner := range job.OwnerReferences {
		if owner.Kind == "CronJob" {
			return types.JobStatusDelta{}, false
		}
	}

	var ownerKind, ownerName string
	if len(job.OwnerReferences) > 0 {
		ownerKind = job.OwnerReferences[0].Kind
		ownerName = job.OwnerReferences[0].Name
	}

	completions := int32(1)
	if job.Spec.Completions != nil {
		completions = *job.Spec.Completions
	}

	parallelism := int32(1)
	if job.Spec.Parallelism != nil {
		parallelism = *job.Spec.Parallelism
	}

	var startTime *time.Time
	if job.Status.StartTime != nil {
		t := job.Status.StartTime.Time.UTC()
		startTime = &t
	}

	var completionTime *time.Time
	if job.Status.CompletionTime != nil {
		t := job.Status.CompletionTime.Time.UTC()
		completionTime = &t
	}

	var durationSeconds int64 = 0
	if startTime != nil {
		if completionTime != nil {
			durationSeconds = int64(completionTime.Sub(*startTime).Seconds())
		} else {
			durationSeconds = int64(time.Now().UTC().Sub(*startTime).Seconds())
		}
		if durationSeconds < 0 {
			durationSeconds = 0
		}
	}

	delta := types.JobStatusDelta{
		Name:            job.Name,
		Namespace:       job.Namespace,
		Completions:     completions,
		Parallelism:     parallelism,
		Succeeded:       job.Status.Succeeded,
		Failed:          job.Status.Failed,
		Active:          job.Status.Active,
		StartTime:       startTime,
		CompletionTime:  completionTime,
		DurationSeconds: durationSeconds,
		Labels:          job.Labels,
		OwnerKind:       ownerKind,
		OwnerName:       ownerName,
		CreatedAt:       job.CreationTimestamp.Time.UTC(),
	}

	return delta, true
}

// emitJobDelta broadcasts EVENT_JOB_MUTATED to WebSocket clients if the job is standalone.
func (im *InformerManager) emitJobDelta(job *batchv1.Job) {
	delta, isStandalone := im.extractJobDelta(job)
	if !isStandalone {
		return
	}

	key := fmt.Sprintf("Job/%s/%s", job.Namespace, job.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}

	log.Printf("[Informer] Emitting Job update: %s/%s (active: %d, succeeded: %d, failed: %d)",
		job.Namespace, job.Name, delta.Active, delta.Succeeded, delta.Failed)
	im.hub.BroadcastEvent(types.EventJobMutated, im.clusterID, delta)
}

// emitJobDeleted broadcasts EVENT_JOB_DELETED to WebSocket clients if the job is standalone.
func (im *InformerManager) emitJobDeleted(job *batchv1.Job) {
	delta, isStandalone := im.extractJobDelta(job)
	if !isStandalone {
		return
	}

	key := fmt.Sprintf("Job/%s/%s", job.Namespace, job.Name)
	im.dedup.Remove(key)
	im.hub.BroadcastEvent(types.EventJobDeleted, im.clusterID, delta)
}

// getJobsSnapshot lists all standalone batchv1.Jobs from the informer cache.
func (im *InformerManager) getJobsSnapshot() []types.JobStatusDelta {
	var jobs []types.JobStatusDelta
	jobList := im.factory.Batch().V1().Jobs().Informer().GetStore().List()
	for _, obj := range jobList {
		if j, ok := obj.(*batchv1.Job); ok {
			delta, isStandalone := im.extractJobDelta(j)
			if isStandalone {
				jobs = append(jobs, delta)
			}
		}
	}
	if jobs == nil {
		jobs = []types.JobStatusDelta{}
	}
	return jobs
}

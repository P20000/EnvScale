package k8s

// compareNumeric compares an actual metric value with a threshold using standard operators.
func compareNumeric(actual float64, op string, threshold float64) bool {
	switch op {
	case ">":
		return actual > threshold
	case ">=":
		return actual >= threshold
	case "<":
		return actual < threshold
	case "<=":
		return actual <= threshold
	case "==":
		return actual == threshold
	case "!=":
		return actual != threshold
	default:
		return false
	}
}

// compareString compares string status values using equality or inequality operators.
func compareString(actual, op, expected string) bool {
	switch op {
	case "==":
		return actual == expected
	case "!=":
		return actual != expected
	default:
		return false
	}
}

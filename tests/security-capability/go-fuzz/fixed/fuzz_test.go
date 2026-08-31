package fuzzfixture

import "testing"

func FuzzInputValidation(f *testing.F) {
	f.Add("boom")
	f.Fuzz(func(t *testing.T, input string) {
		if input == "boom" {
			return
		}
	})
}

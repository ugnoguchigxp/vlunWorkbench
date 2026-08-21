package racefixture

import (
	"sync"
	"testing"
)

func TestNoRace(t *testing.T) {
	var value int
	var lock sync.Mutex
	var group sync.WaitGroup
	group.Add(2)
	for worker := 0; worker < 2; worker++ {
		go func() {
			defer group.Done()
			for index := 0; index < 1000; index++ {
				lock.Lock()
				value++
				lock.Unlock()
			}
		}()
	}
	group.Wait()
}

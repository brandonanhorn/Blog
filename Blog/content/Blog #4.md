Title: Numba
Date: 2020-01-29
Slug: Fourth blog

Today's blog post will be on Numba, a python package that is used for speeding up loops, NumPy functions and NumPy broadcasting. This package is hyper-powerful for those who are looking to speed up their service speed.

To install Numba, just like any other package, you use:


```python
!pip install numba
```

To use numba, you import it using the call below, and to run Numba you simply add an @jit call before your function, for example:


```python
from numba import jit

@jit
```

You can use many different arguements with the Jit command as well, such as:


```python
@jit(nopython=True) or @njit or @njit(fastmath=False) or @njit(parallel=True)
```

Let's jump into an example and see how Numba performs.

First, I'm going to bring in NumPy; then, I'm going to write a primary function then I am going to add some data and see how it performs without the power of Numba.


```python
import numpy as np
```


```python
def sorting(X):
    N = len(X)
    for end in range(N, 2, -2):
        for i in range(end - 2):
            cur = X[i]
            if cur > X[i + 2]:
                tmp = X[i]
                X[i] = X[i + 2]
                X[i + 2] = tmp
```


```python
original = np.arange(0.0, 50.0, 0.05)
shuffled = original.copy()
np.random.shuffle(shuffled)
```


```python
sort_it = shuffled.copy()
sorting(sort_it)
```


```python
%timeit sort_it[:] = shuffled[:]; sorting(sort_it)
```

    212 ms ± 16.7 ms per loop (mean ± std. dev. of 7 runs, 1 loop each)


So you can see that, without any help from Numba, the speed it took to run through that function was 212 ms, or 212000 µs, which will be valuable to know in comparing later.

Now its time to see what Numba can do with the same function.


```python
@jit
def sorting(X):
    N = len(X)
    for end in range(N, 2, -2):
        for i in range(end - 2):
            cur = X[i]
            if cur > X[i + 2]:
                tmp = X[i]
                X[i] = X[i + 2]
                X[i + 2] = tmp
```


```python
%timeit sort_it[:] = shuffled[:]; sorting(sort_it)
```

    389 µs ± 6.77 µs per loop (mean ± std. dev. of 7 runs, 1 loop each)


You can see that it took Numba 389 µs to run that function. More than 500 times faster than a function without it.


![png](images/shocked.png)

You should be as shocked as the monkey above. That is a severe increase in speed when it comes to running functions and NumPy arrays.

So, take this new power with you and use it to increase your productivity!


Title: PyAutoGui - Runescape Bot
Date: 2020-06-01
Slug: Sixth blog

Today's blog will be about automation. More specifically, about using the package called PyAutoGui, to automate actions in a video game called Runescape.

Runescape is a Massive Multiplayer Online Role-Playing Game(MMORP), which has various skills that you level up to make your character stronger. Most of these skills take long hours of repetitive mouse-clicking, which I am personally not interested in doing. So, inspired by "Automate the Boring Stuff with Python," written by Al Sweigart, I decided to automate the "skilling" aspect of Runescape. 

To start off, simply install pyautogui. 

Type or copy the code below into your terminal.


```python
# pip install pyautogui
```

After install, you import PyAutoGui and its features in your text editor using the code:


```python
import pyautogui
from pyautogui import press, typewrite, hotkey, screenshot
```

So, this is not a complicated code at all to set up. It is about thinking out what you would typically do - and using PyAutoGui to complete those tasks. The first tool we will look at is the mouse clicking tool.

To take advantage of the mouse clicking tool, you will first need to use the positional tool. Run the code below and move your mouse all over your screen.


```python
pyautogui.position()
```




    Point(x=878, y=671)



You will see that it gives you a location for a position on your screen. It gives you the x-coordinate as well as the y-coordinate. This will be important as you build out your own tool.

Next, you can start using the click tools from PyAutoGui


```python
pyautogui.click(878,671)
```

This acts as if you were pushing your left mouse button down on a specific spot. 

You can also use:


```python
pyautogui.mouseDown(button="left", x=878, y=671)
```

to accomplish the same thing, as the click, but you can all change the mouse button to:


```python
pyautogui.mouseDown(button="right", x=878, y=671)
```

To use the right click on the mouse. 

You can probably already imagine how you could use just those functions to build something interesting, but, there are more commands with PyAutoGui worth mentioning, like:


```python
import time
time.sleep(1)
pyautogui.write("Hello World")
```


```python
time.sleep(1)
pyautogui.press("insert any key")
```


```python
time.sleep(1)
pyautogui.keyDown("insert any key")
time.sleep(1)
pyautogui.keyUp("insert any key")
```

Notice how I use the time package to make the mouse clicks, not instantaneous.

Before we go any farther, I should mention the failsafe that PyAutoGui has. If you throw yourself in an infinite loop where your mouse or keyboard is in control, you will need something to get out of it. 


```python
pyautogui.FAILSAFE = True
```

The code above allows you to move your cursor to the top left of your screen and shut down the program.

With these few keys, you would be able to build out any type of tool you'd like to make. You can become a hacker today! 

Below I will add my full code, which I use to make money in Runescape. I will attach the full code and a video that I sped up to show people how the code works. 

### *This code was written to work on a 21.5" iMac, you will have to change where each "click" is to fit your screen*


```python
import pyautogui
import random
import time
from pyautogui import press, typewrite, hotkey, screenshot

pyautogui.position()
## start at alter click to move north to top
## raise camera view as high as possible
for i in range(200):
    time.sleep(2)
    for i in range(9):
        pyautogui.FAILSAFE = True
        time.sleep(2)
        pyautogui.mouseDown(button='left', x=1726, y=149)
        time.sleep(.5)
        pyautogui.click(1810,758)
        time.sleep(.2)
        pyautogui.mouseDown(button='left', x=959, y=567)
        time.sleep(4)
        pyautogui.click(1872,152)
        time.sleep(5)
        pyautogui.mouseDown(button='left', x=1726, y=149)
        time.sleep(2)
        pyautogui.click(1843,152)
        time.sleep(5)
        pyautogui.click(1754,157)
        time.sleep(7)
        pyautogui.click(1773,157)
        time.sleep(5)

    else:
        time.sleep(2)
        pyautogui.click(697,461)
        time.sleep(6)
        pyautogui.click(1827,163)
        time.sleep(.5)

    for i in range(9):
        time.sleep(2)
        pyautogui.mouseDown(button='left', x=1726, y=149)
        time.sleep(.5)
        pyautogui.click(1810,758)
        time.sleep(.2)
        pyautogui.mouseDown(button='left', x=959, y=567)
        time.sleep(4)
        pyautogui.click(1872,152)
        time.sleep(5)
        pyautogui.mouseDown(button='left', x=1726, y=149)
        time.sleep(2)
        pyautogui.click(1843,152)
        time.sleep(5)
        pyautogui.click(1754,157)
        time.sleep(7)
        pyautogui.click(1773,157)
        time.sleep(5)

    else:
        time.sleep(2)
        pyautogui.click(697,461)
        time.sleep(6)
        pyautogui.click(1827,163)
        time.sleep(.5)

    for i in range(9):
        time.sleep(2)
        pyautogui.mouseDown(button='left', x=1726, y=149)
        time.sleep(.5)
        pyautogui.click(1810,758)
        time.sleep(.2)
        pyautogui.mouseDown(button='left', x=959, y=567)
        time.sleep(4)
        pyautogui.click(1872,152)
        time.sleep(5)
        pyautogui.mouseDown(button='left', x=1726, y=149)
        time.sleep(2)
        pyautogui.click(1843,152)
        time.sleep(5)
        pyautogui.click(1754,157)
        time.sleep(7)
        pyautogui.click(1773,157)
        time.sleep(5)

#pyautogui.position()
#ardonuge banking
    else:
        time.sleep(1)
        pyautogui.click(697,461)
        time.sleep(6)
        pyautogui.mouseDown(button='left', x=1887, y=77)
        time.sleep(3)
        pyautogui.mouseDown(button='left', x=867, y=504)
        time.sleep(30)
        pyautogui.click(1779,211)
        time.sleep(8)
        pyautogui.click(597,638)
        time.sleep(9)
        pyautogui.mouseDown(button='left', x=1128, y=430)
        time.sleep(3)
        pyautogui.mouseDown(button='left', x=1114, y=605)
        time.sleep(3)
        #falador walk back
        pyautogui.mouseDown(button='left', x=1888, y=77)
        time.sleep(3)
        pyautogui.mouseDown(button='left', x=973, y=504)
        time.sleep(29)
        pyautogui.click(1776,97)
        time.sleep(8)
        pyautogui.click(1780,95)
        time.sleep(8)
        pyautogui.click(1804,89)
        time.sleep(8)
        pyautogui.click(1821,86)
        time.sleep(9)
        pyautogui.click(1820,118)
        time.sleep(8)


#pyautogui.position()

```


```python
from IPython.display import HTML
video_path = './images/full_run.mp4'

HTML("""
<video width="840" height="460" controls="">
<source src="{0}">
</video>
""".format(video_path))
```





<video width="840" height="460" controls="">
<source src="./images/full_run.mp4">
</video>




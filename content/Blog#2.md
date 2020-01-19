Title: Altair
Date: 2020-01-04
Slug: Second blog

```python
import pandas as pd
import altair as alt
```

This week's blog will be about the importance of visualizations. I will take a bad example of a chart, in this case, a pie chart released by Fox news in 2012 showing Vice President candidates, and create a new chart - that is better overall. I will use Altair, which is another package that should be in your tool belt as a data scientist.

This is the lousy graph below. You should be able to see a few things wrong with it. First off, pie charts are the worst way to represent data because it is hard to see which piece is more significant than the other pieces. Palin has a 10% lead over Romney but, it is hard to view it.

![png](images/fox_graph.png)

These first steps are just recreating the data.


```python
fox_data = {
    'Palin': 70,
    'Huckabee': 63,
    'Romney': 60
}
```


```python
df_fox = pd.DataFrame(list(fox_data.items()))
```


```python
df_fox
```




<div>
<style scoped>
    .dataframe tbody tr th:only-of-type {
        vertical-align: middle;
    }

    .dataframe tbody tr th {
        vertical-align: top;
    }

    .dataframe thead th {
        text-align: right;
    }
</style>
<table border="1" class="dataframe">
  <thead>
    <tr style="text-align: right;">
      <th></th>
      <th>0</th>
      <th>1</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>0</td>
      <td>Palin</td>
      <td>70</td>
    </tr>
    <tr>
      <td>1</td>
      <td>Huckabee</td>
      <td>63</td>
    </tr>
    <tr>
      <td>2</td>
      <td>Romney</td>
      <td>60</td>
    </tr>
  </tbody>
</table>
</div>




```python
df_fox.columns = ['GOP Nominee','Percentage Backing']
```

Now, let's get rid of the pie chart and replace it with a bar graph.


```python
(
    alt.Chart(df_fox)
    .mark_bar()
    .encode(
    x='GOP Nominee',
    y='Percentage Backing',)
    .properties(height=200, width=200)
)
```





<div id="altair-viz-8"></div>
<script type="text/javascript">
  (function(spec, embedOpt){
    const outputDiv = document.getElementById("altair-viz-8");
    const paths = {
      "vega": "https://cdn.jsdelivr.net/npm//vega@5?noext",
      "vega-lib": "https://cdn.jsdelivr.net/npm//vega-lib?noext",
      "vega-lite": "https://cdn.jsdelivr.net/npm//vega-lite@4.0.0?noext",
      "vega-embed": "https://cdn.jsdelivr.net/npm//vega-embed@6?noext",
    };

    function loadScript(lib) {
      return new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = paths[lib];
        s.async = true;
        s.onload = () => resolve(paths[lib]);
        s.onerror = () => reject(`Error loading script: ${paths[lib]}`);
        document.getElementsByTagName("head")[0].appendChild(s);
      });
    }

    function showError(err) {
      outputDiv.innerHTML = `<div class="error" style="color:red;">${err}</div>`;
      throw err;
    }

    function displayChart(vegaEmbed) {
      vegaEmbed(outputDiv, spec, embedOpt)
        .catch(err => showError(`Javascript Error: ${err.message}<br>This usually means there's a typo in your chart specification. See the javascript console for the full traceback.`));
    }

    if(typeof define === "function" && define.amd) {
      requirejs.config({paths});
      require(["vega-embed"], displayChart, err => showError(`Error loading script: ${err.message}`));
    } else if (typeof vegaEmbed === "function") {
      displayChart(vegaEmbed);
    } else {
      loadScript("vega")
        .then(() => loadScript("vega-lite"))
        .then(() => loadScript("vega-embed"))
        .catch(showError)
        .then(() => displayChart(vegaEmbed));
    }
  })({"config": {"view": {"continuousWidth": 400, "continuousHeight": 300}}, "data": {"name": "data-b27a86ca740ae6672fbb17ecc533fd43"}, "mark": "bar", "encoding": {"x": {"type": "nominal", "field": "GOP Nominee"}, "y": {"type": "quantitative", "field": "Percentage Backing"}}, "height": 200, "width": 200, "$schema": "https://vega.github.io/schema/vega-lite/v4.0.0.json", "datasets": {"data-b27a86ca740ae6672fbb17ecc533fd43": [{"GOP Nominee": "Palin", "Percentage Backing": 70}, {"GOP Nominee": "Huckabee", "Percentage Backing": 63}, {"GOP Nominee": "Romney", "Percentage Backing": 60}]}}, {"mode": "vega-lite"});
</script>



Then lets add some color based on each category on our X axis.


```python
(
    alt.Chart(df_fox)
    .mark_bar()
    .encode(
    x='GOP Nominee',
    y='Percentage Backing',
    color='GOP Nominee') ## This is the added code
    .properties(height=200, width=200)
)
```





<div id="altair-viz-9"></div>
<script type="text/javascript">
  (function(spec, embedOpt){
    const outputDiv = document.getElementById("altair-viz-9");
    const paths = {
      "vega": "https://cdn.jsdelivr.net/npm//vega@5?noext",
      "vega-lib": "https://cdn.jsdelivr.net/npm//vega-lib?noext",
      "vega-lite": "https://cdn.jsdelivr.net/npm//vega-lite@4.0.0?noext",
      "vega-embed": "https://cdn.jsdelivr.net/npm//vega-embed@6?noext",
    };

    function loadScript(lib) {
      return new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = paths[lib];
        s.async = true;
        s.onload = () => resolve(paths[lib]);
        s.onerror = () => reject(`Error loading script: ${paths[lib]}`);
        document.getElementsByTagName("head")[0].appendChild(s);
      });
    }

    function showError(err) {
      outputDiv.innerHTML = `<div class="error" style="color:red;">${err}</div>`;
      throw err;
    }

    function displayChart(vegaEmbed) {
      vegaEmbed(outputDiv, spec, embedOpt)
        .catch(err => showError(`Javascript Error: ${err.message}<br>This usually means there's a typo in your chart specification. See the javascript console for the full traceback.`));
    }

    if(typeof define === "function" && define.amd) {
      requirejs.config({paths});
      require(["vega-embed"], displayChart, err => showError(`Error loading script: ${err.message}`));
    } else if (typeof vegaEmbed === "function") {
      displayChart(vegaEmbed);
    } else {
      loadScript("vega")
        .then(() => loadScript("vega-lite"))
        .then(() => loadScript("vega-embed"))
        .catch(showError)
        .then(() => displayChart(vegaEmbed));
    }
  })({"config": {"view": {"continuousWidth": 400, "continuousHeight": 300}}, "data": {"name": "data-b27a86ca740ae6672fbb17ecc533fd43"}, "mark": "bar", "encoding": {"color": {"type": "nominal", "field": "GOP Nominee"}, "x": {"type": "nominal", "field": "GOP Nominee"}, "y": {"type": "quantitative", "field": "Percentage Backing"}}, "height": 200, "width": 200, "$schema": "https://vega.github.io/schema/vega-lite/v4.0.0.json", "datasets": {"data-b27a86ca740ae6672fbb17ecc533fd43": [{"GOP Nominee": "Palin", "Percentage Backing": 70}, {"GOP Nominee": "Huckabee", "Percentage Backing": 63}, {"GOP Nominee": "Romney", "Percentage Backing": 60}]}}, {"mode": "vega-lite"});
</script>



Now, let's change the titles on each axis to make the information more digestible.


```python
(
    alt.Chart(df_fox)
    .mark_bar()
    .encode(
    x=alt.X('GOP Nominee', axis=alt.Axis(title='Nominee')), ## This is the added code
    y=alt.Y('Percentage Backing', axis=alt.Axis(title='Percent')), ## This is the added code
    color='GOP Nominee')
    .properties(height=200, width=200)
)
```





<div id="altair-viz-11"></div>
<script type="text/javascript">
  (function(spec, embedOpt){
    const outputDiv = document.getElementById("altair-viz-11");
    const paths = {
      "vega": "https://cdn.jsdelivr.net/npm//vega@5?noext",
      "vega-lib": "https://cdn.jsdelivr.net/npm//vega-lib?noext",
      "vega-lite": "https://cdn.jsdelivr.net/npm//vega-lite@4.0.0?noext",
      "vega-embed": "https://cdn.jsdelivr.net/npm//vega-embed@6?noext",
    };

    function loadScript(lib) {
      return new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = paths[lib];
        s.async = true;
        s.onload = () => resolve(paths[lib]);
        s.onerror = () => reject(`Error loading script: ${paths[lib]}`);
        document.getElementsByTagName("head")[0].appendChild(s);
      });
    }

    function showError(err) {
      outputDiv.innerHTML = `<div class="error" style="color:red;">${err}</div>`;
      throw err;
    }

    function displayChart(vegaEmbed) {
      vegaEmbed(outputDiv, spec, embedOpt)
        .catch(err => showError(`Javascript Error: ${err.message}<br>This usually means there's a typo in your chart specification. See the javascript console for the full traceback.`));
    }

    if(typeof define === "function" && define.amd) {
      requirejs.config({paths});
      require(["vega-embed"], displayChart, err => showError(`Error loading script: ${err.message}`));
    } else if (typeof vegaEmbed === "function") {
      displayChart(vegaEmbed);
    } else {
      loadScript("vega")
        .then(() => loadScript("vega-lite"))
        .then(() => loadScript("vega-embed"))
        .catch(showError)
        .then(() => displayChart(vegaEmbed));
    }
  })({"config": {"view": {"continuousWidth": 400, "continuousHeight": 300}}, "data": {"name": "data-b27a86ca740ae6672fbb17ecc533fd43"}, "mark": "bar", "encoding": {"color": {"type": "nominal", "field": "GOP Nominee"}, "x": {"type": "nominal", "axis": {"title": "Nominee"}, "field": "GOP Nominee"}, "y": {"type": "quantitative", "axis": {"title": "Percent"}, "field": "Percentage Backing"}}, "height": 200, "width": 200, "$schema": "https://vega.github.io/schema/vega-lite/v4.0.0.json", "datasets": {"data-b27a86ca740ae6672fbb17ecc533fd43": [{"GOP Nominee": "Palin", "Percentage Backing": 70}, {"GOP Nominee": "Huckabee", "Percentage Backing": 63}, {"GOP Nominee": "Romney", "Percentage Backing": 60}]}}, {"mode": "vega-lite"});
</script>



Lastly, lets add a title to give the chart an overall theme.


```python
(
    alt.Chart(df_fox)
    .mark_bar()
    .encode(
    x=alt.X('GOP Nominee', axis=alt.Axis(title='Nominee')),
    y=alt.Y('Percentage Backing', axis=alt.Axis(title='Percent')),
    color='GOP Nominee')
    .properties(height=200, width=200, title='Vice-Presidential Choice') ## This is the added code
)
```





<div id="altair-viz-14"></div>
<script type="text/javascript">
  (function(spec, embedOpt){
    const outputDiv = document.getElementById("altair-viz-14");
    const paths = {
      "vega": "https://cdn.jsdelivr.net/npm//vega@5?noext",
      "vega-lib": "https://cdn.jsdelivr.net/npm//vega-lib?noext",
      "vega-lite": "https://cdn.jsdelivr.net/npm//vega-lite@4.0.0?noext",
      "vega-embed": "https://cdn.jsdelivr.net/npm//vega-embed@6?noext",
    };

    function loadScript(lib) {
      return new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = paths[lib];
        s.async = true;
        s.onload = () => resolve(paths[lib]);
        s.onerror = () => reject(`Error loading script: ${paths[lib]}`);
        document.getElementsByTagName("head")[0].appendChild(s);
      });
    }

    function showError(err) {
      outputDiv.innerHTML = `<div class="error" style="color:red;">${err}</div>`;
      throw err;
    }

    function displayChart(vegaEmbed) {
      vegaEmbed(outputDiv, spec, embedOpt)
        .catch(err => showError(`Javascript Error: ${err.message}<br>This usually means there's a typo in your chart specification. See the javascript console for the full traceback.`));
    }

    if(typeof define === "function" && define.amd) {
      requirejs.config({paths});
      require(["vega-embed"], displayChart, err => showError(`Error loading script: ${err.message}`));
    } else if (typeof vegaEmbed === "function") {
      displayChart(vegaEmbed);
    } else {
      loadScript("vega")
        .then(() => loadScript("vega-lite"))
        .then(() => loadScript("vega-embed"))
        .catch(showError)
        .then(() => displayChart(vegaEmbed));
    }
  })({"config": {"view": {"continuousWidth": 400, "continuousHeight": 300}}, "data": {"name": "data-b27a86ca740ae6672fbb17ecc533fd43"}, "mark": "bar", "encoding": {"color": {"type": "nominal", "field": "GOP Nominee"}, "x": {"type": "nominal", "axis": {"title": "Nominee"}, "field": "GOP Nominee"}, "y": {"type": "quantitative", "axis": {"title": "Percent"}, "field": "Percentage Backing"}}, "height": 200, "title": "Vice-Presidential Choice", "width": 200, "$schema": "https://vega.github.io/schema/vega-lite/v4.0.0.json", "datasets": {"data-b27a86ca740ae6672fbb17ecc533fd43": [{"GOP Nominee": "Palin", "Percentage Backing": 70}, {"GOP Nominee": "Huckabee", "Percentage Backing": 63}, {"GOP Nominee": "Romney", "Percentage Backing": 60}]}}, {"mode": "vega-lite"});
</script>



As you can see now, this graph is much cleaner looking, more comfortable to read, and overall better than it was before. In conclusion, Altair is an easy to use Python library that makes good looking images with just a few lines of codes.

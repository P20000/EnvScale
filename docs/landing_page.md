this is the descriptive information of how the landing page of the application look like: 

- this page is an on scroll trigger animation type of an application slideshow.   
- the first section will show a video that is already inside the `docs/video/gemini_generated_video.mp4` and it shall be playing in the full screen and should progress as the user scrolls. 
 
-as the video finishes, the "envscale" 


>  **the background of the entire page will be in light mode to match the video.** 

- as the user will keep scrolling the rest of the information will keep on appearing with a nice simple fade from the bottom. 

- information shall be shown in `<card>` to the left "information about the card" to the card's right.  

- the prop that was used as mandala, we will use it around the whole landing place in random places in large sizes or medium sizes wherever feels right. (this is the mandala art). 

```tsx
<svg viewBox="0 0 926.02 965.4" className="w-full h-full text-blue-500">
                <path d="M934.76,524.77a80,80,0,0,1,0-49.54l24.32-74.86A80.14,80.14,0,0,0,930,310.76l-63.67-46.27a80.08,80.08,0,0,1-29.12-40.08l-24.33-74.86a80.14,80.14,0,0,0-76.23-55.38h-78.7a80.16,80.16,0,0,1-47.11-15.3L547.11,32.6a80.18,80.18,0,0,0-94.22,0L389.2,78.87a80.16,80.16,0,0,1-47.11,15.3h-78.7a80.14,80.14,0,0,0-76.23,55.38l-24.33,74.86a80.08,80.08,0,0,1-29.12,40.08L70,310.76a80.14,80.14,0,0,0-29.12,89.61l24.32,74.86a80,80,0,0,1,0,49.54L40.92,599.63A80.14,80.14,0,0,0,70,689.24l63.67,46.27a80.08,80.08,0,0,1,29.12,40.08l24.33,74.86a80.14,80.14,0,0,0,76.23,55.38h78.7a80.16,80.16,0,0,1,47.11,15.3l63.69,46.27a80.18,80.18,0,0,0,94.22,0l63.69-46.27a80.16,80.16,0,0,1,47.11-15.3h78.7a80.14,80.14,0,0,0,76.23-55.38l24.33-74.86a80.08,80.08,0,0,1,29.12-40.08L930,689.24a80.14,80.14,0,0,0,29.12-89.61Zm-241.07-108a37.22,37.22,0,1,1,10.63-51.55A37.23,37.23,0,0,1,693.69,416.72Zm50.63,94.14A37.22,37.22,0,1,1,708.87,472,37.22,37.22,0,0,1,744.32,510.86Zm-158-240.06a37.22,37.22,0,1,1-47.95,21.71A37.22,37.22,0,0,1,586.31,270.8ZM500,101.09a60.74,60.74,0,1,1-60.73,60.72A60.72,60.72,0,0,1,500,101.09ZM435.38,263.82a37.22,37.22,0,1,1-26,45.74A37.24,37.24,0,0,1,435.38,263.82ZM265.52,177.27a60.73,60.73,0,1,1-13.43,84.84A60.74,60.74,0,0,1,265.52,177.27Zm64.75,314.44a37.22,37.22,0,1,1-35.46-38.9A37.22,37.22,0,0,1,330.27,491.71ZM197.13,662.27a60.74,60.74,0,1,1,39-76.54A60.74,60.74,0,0,1,197.13,662.27Zm39-248a60.73,60.73,0,1,1-39-76.54A60.74,60.74,0,0,1,236.13,414.27Zm114.22,395a60.73,60.73,0,1,1-13.43-84.83A60.74,60.74,0,0,1,350.35,809.29ZM347.47,644.6a37.22,37.22,0,1,1,10.62-51.55A37.21,37.21,0,0,1,347.47,644.6Zm19.85-251.22a37.22,37.22,0,1,1-5.83-52.32A37.22,37.22,0,0,1,367.32,393.38Zm46.59,335a37.23,37.23,0,1,1,47.95-21.72A37.23,37.23,0,0,1,413.91,728.34ZM500,898.91a60.74,60.74,0,1,1,60.73-60.72A60.72,60.72,0,0,1,500,898.91Zm64.84-163.59a37.22,37.22,0,1,1,26-45.76A37.22,37.22,0,0,1,564.84,735.32ZM632.9,605.75a37.22,37.22,0,1,1,5.83,52.31A37.22,37.22,0,0,1,632.9,605.75Zm101.58,217a60.73,60.73,0,1,1,13.43-84.84A60.74,60.74,0,0,1,734.48,822.73Zm13.43-560.62a60.73,60.73,0,1,1-13.43-84.84A60.74,60.74,0,0,1,747.91,262.11ZM879.39,623.28a60.73,60.73,0,1,1-39-76.54A60.74,60.74,0,0,1,879.39,623.28Zm-39-170a60.74,60.74,0,1,1,39-76.54A60.74,60.74,0,0,1,840.4,453.26Z" transform="translate(-36.99 -17.3)" fill="currentColor" />
              </svg>
```

- we will be using the information that is already in the current "how envscale operates under the hood" section and will build the cards and it's information in relevant such manners. 

## style of cards : 

- demonstrating venn diagrams, algorithmic diagrams and mermaid diagrams if they are to be used. 

# fonts : 

- will be using the font : 
    - primary font style : google sans
    - secondary font style : courgette

- for "information" next to card : 

    ### courgette 
    ```html
    <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>


        for headings : 
        ```html
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Courgette&family=Google+Sans+Code:ital,wght,MONO@0,300..800,1;1,300..800,1&family=Google+Sans:ital,opsz,wght@0,17..18,400..700;1,17..18,400..700&family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap" rel="stylesheet">
        ```
    - for card title :
        - ### Google Sans
        ```html
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Courgette&family=Google+Sans+Code:ital,wght,MONO@0,300..800,1;1,300..800,1&family=Google+Sans:ital,opsz,wght@0,17..18,400..700;1,17..18,400..700&family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap" rel="stylesheet">
        ```


> improvision, : 

- instead of writing ENVSCale PLATFORM you can replace it with a big logo of ENVSCALE without any backgroud div to it. 

remove multi-tenant kubernetes oversvability & governance. 

remove : "Eliminate polling lag and ephemeral crash blind spots. EnvScale captures Kubernetes state via Go Informers and streams sub-200ms deltas directly to an ArgoCD-grade canvas with dynamic health index scoring."

remove the button : "how envscale operates under the hood"

place the get started button just below the ENVSCALE and make EnvScale --> ENVSCALE 

title should be smaller - title : " EnvScale" that's it. 

add animations to the page contents like fade animations. 